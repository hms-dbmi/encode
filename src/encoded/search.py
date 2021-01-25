import re
import math
import itertools
from functools import reduce
from pyramid.view import view_config
from webob.multidict import MultiDict
from snovault import (
    AbstractCollection,
    TYPES,
    COLLECTIONS
)
from snovault.embed import make_subrequest
from snovault.elasticsearch import ELASTIC_SEARCH
from snovault.elasticsearch.create_mapping import determine_if_is_date_field
from snovault.elasticsearch.indexer_utils import get_namespaced_index
from snovault.resource_views import collection_view_listing_db
from snovault.util import (
    find_collection_subtypes,
    crawl_schema,
    debug_log
)
from snovault.typeinfo import AbstractTypeInfo
from elasticsearch.helpers import scan
from elasticsearch_dsl import Search
from elasticsearch import (
    TransportError,
    RequestError,
    ConnectionTimeout
)
from elasticsearch.exceptions import NotFoundError
from pyramid.httpexceptions import (
    HTTPBadRequest,
    HTTPFound
)
from urllib.parse import urlencode
from collections import OrderedDict
from copy import deepcopy
import uuid
import structlog

log = structlog.getLogger(__name__)


def includeme(config):
    config.add_route('search', '/search{slash:/?}')
    config.add_route('browse', '/browse{slash:/?}')
    config.scan(__name__)

sanitize_search_string_re = re.compile(r'[\\\+\-\&\|\!\(\)\{\}\[\]\^\~\:\/\\\*\?]')


COMMON_EXCLUDED_URI_PARAMS = [
    'frame', 'format', 'limit', 'sort', 'from', 'field',
    'mode', 'redirected_from', 'datastore', 'referrer',
    'currentAction', 'additional_facet'
]


@view_config(route_name='search', request_method='GET', permission='search')
@debug_log
def search(context, request, search_type=None, return_generator=False, forced_type='Search', custom_aggregations=None):
    """
    Search view connects to ElasticSearch and returns the results
    """
    types = request.registry[TYPES]
    # list of item types used from the query
    doc_types = set_doc_types(request, types, search_type)
    # calculate @type. Exclude ItemSearchResults unless no other types selected.
    search_types = build_search_types(types, doc_types)
    search_types.append(forced_type)  # the old base search type

    # sets request.normalized_params
    search_base = normalize_query(request, types, doc_types)
    ### INITIALIZE RESULT.
    result = {
        '@context': request.route_path('jsonld_context'),
        '@id': '/' + forced_type.lower() + '/' + search_base,
        '@type': search_types,
        'title': forced_type,
        'filters': [],
        'facets': [],
        '@graph': [],
        'notification': '',
        'sort': {}
    }
    principals = request.effective_principals
    es = request.registry[ELASTIC_SEARCH]

    # Get static section (if applicable) when searching a single item type
    # Note: Because we rely on 'source', if the static_section hasn't been indexed
    # into Elasticsearch it will not be loaded
    if (len(doc_types) == 1) and 'Item' not in doc_types:
        search_term = 'search-info-header.' + doc_types[0]
        try:
            static_section = request.registry['collections']['StaticSection'].get(search_term)
        except Exception:  # search could fail, NotFoundError does not catch for some reason
            static_section = None
        if static_section and hasattr(static_section.model, 'source'):
            item = static_section.model.source['object']
            result['search_header'] = {}
            result['search_header']['content'] = item['content']
            result['search_header']['title'] = item.get('title', item['display_title'])
            result['search_header']['filetype'] = item['filetype']

    from_, size = get_pagination(request)

    # get desired frame for this search
    search_frame = request.normalized_params.get('frame', 'embedded')

    ### PREPARE SEARCH TERM
    prepared_terms = prepare_search_term(request)

    schemas = [types[item_type].schema for item_type in doc_types]

    # set ES index based on doc_type (one type per index)
    # if doc_type is item, search all indexes by setting es_index to None
    # If multiple, search all specified
    if 'Item' in doc_types:
        es_index = get_namespaced_index(request, '*')
    else:
        es_index = find_index_by_doc_types(request, doc_types, ['Item'])

    # establish elasticsearch_dsl class that will perform the search
    search = Search(using=es, index=es_index)

    # set up clear_filters path
    result['clear_filters'] = clear_filters_setup(request, doc_types, forced_type)

    ### SET TYPE FILTERS
    build_type_filters(result, request, doc_types, types)

    # get the fields that will be used as source for the search
    # currently, supports frame=raw/object but live faceting does not work
    # this is okay because the only non-embedded access will be programmatic
    source_fields = sorted(list_source_fields(request, doc_types, search_frame))

    ### GET FILTERED QUERY
    # Builds filtered query which supports multiple facet selection
    search, string_query = build_query(search, prepared_terms, source_fields)

    ### Set sort order
    search = set_sort_order(request, search, prepared_terms, types, doc_types, result)
    # TODO: implement BOOST here?

    ### Set filters
    search, query_filters = set_filters(request, search, result, principals, doc_types)

    ### Set starting facets
    additional_facets = request.normalized_params.getall('additional_facet')
    facets = initialize_facets(request, doc_types, prepared_terms, schemas, additional_facets)

    ### Adding facets, plus any optional custom aggregations.
    ### Uses 'size' and 'from_' to conditionally skip (no facets if from > 0; no aggs if size > 0).
    search = set_facets(search, facets, query_filters, string_query, request, doc_types, custom_aggregations, size, from_)

    ### Add preference from session, if available
    search_session_id = None
    created_new_search_session_id = False
    if request.__parent__ is None and not return_generator and size != 'all': # Probably unnecessary, but skip for non-paged, sub-reqs, etc.
        search_session_id = request.cookies.get('searchSessionID')
        if not search_session_id:
            search_session_id = 'SESSION-' + str(uuid.uuid1())
            created_new_search_session_id = True
        search = search.params(preference=search_session_id)

    ### Execute the query
    if size == 'all':
        es_results = execute_search_for_all_results(search)
    else:
        size_search = search[from_:from_ + size]
        es_results = execute_search(size_search)

    ### Record total number of hits
    result['total'] = total = es_results['hits']['total']
    result['facets'] = format_facets(es_results, facets, total, additional_facets, search_frame)
    result['aggregations'] = format_extra_aggregations(es_results)

    # Add batch actions
    # TODO: figure out exactly what this does. Provide download URLs?
    # Implement later
    # result.update(search_result_actions(request, doc_types, es_results))

    ### Add all link for collections
    if size not in (None, 'all') and size < result['total']:
        params = [(k, v) for k, v in request.normalized_params.items() if k != 'limit']
        params.append(('limit', 'all'))
        if context:
            result['all'] = '%s?%s' % (request.resource_path(context), urlencode(params))

    # add actions (namely 'add')
    result['actions'] = get_collection_actions(request, types[doc_types[0]])

    if not result['total']:
        # http://googlewebmastercentral.blogspot.com/2014/02/faceted-navigation-best-and-5-of-worst.html
        request.response.status_code = 404
        result['notification'] = 'No results found'
        result['@graph'] = []
        return result if not return_generator else []

    columns = build_table_columns(request, schemas, doc_types)
    if columns:
        result['columns'] = columns

    result['notification'] = 'Success'

    ### Format results for JSON-LD
    graph = format_results(request, es_results['hits']['hits'], search_frame)

    if request.__parent__ is not None or return_generator:
        if return_generator:
            return graph
        else:
            result['@graph'] = list(graph)
            return result

    result['@graph'] = list(graph)
    if created_new_search_session_id:
        request.response.set_cookie('searchSessionID', search_session_id) # Save session ID for re-requests / subsequent pages.
    return result


DEFAULT_BROWSE_PARAM_LISTS = {
    'type'                  : ["ExperimentSetReplicate"],
    'experimentset_type'    : ['replicate'],
    # Uncomment if changing back to showing external data: false by default
    # 'award.project'         : ['4DN']
}

@view_config(route_name='browse', request_method='GET', permission='search')
@debug_log
def browse(context, request, search_type='ExperimentSetReplicate', return_generator=False):
    """
    Simply use search results for browse view
    Redirect to proper URL w. params if needed
    """
    orig_params = request.params
    for k,vals in DEFAULT_BROWSE_PARAM_LISTS.items():
        if k == 'award.project':
            # Could be external or not
            continue
        if k not in orig_params or orig_params[k] not in vals:
            # Redirect to DEFAULT_BROWSE_PARAM_LISTS URL
            next_qs = MultiDict()
            for k2, v2list in DEFAULT_BROWSE_PARAM_LISTS.items():
                for v2 in v2list:
                    next_qs.add(k2, v2)
            # Preserve other keys that arent in DEFAULT_BROWSE_PARAM_LISTS
            for k2, v2 in orig_params.items():
                if k2 not in DEFAULT_BROWSE_PARAM_LISTS:
                    next_qs.add(k2, v2)
            # next_qs.add("redirected_from", str(request.path_qs))
            return HTTPFound(
                location=str(request.path) + '?' +  urlencode(next_qs),
                detail="Redirected from " + str(request.path_info)
            )
    return search(context, request, search_type, return_generator, forced_type='Browse')


@view_config(context=AbstractCollection, permission='list', request_method='GET')
@debug_log
def collection_view(context, request):
    """
    Simply use search results for collections views (e.g./biosamples/)
    This is a redirect directly to the search page
    """
    return search(context, request, context.type_info.name, False, forced_type='Search')


def build_search_types(types, doc_types):
    """
    Builds `search_types` based on the requested search `type` in URI param (=> `doc_types`).

    :param types: TypesTool from the registry
    :param doc_types: Type names we would like to search on.
    :return: search_types, or a list of 'SearchResults' type candidates
    """
    encompassing_ti_for_all_items = None
    for requested_search_type in doc_types: # Handles if only 1 type in here, also.
        ti = types[requested_search_type]   # 'ti' == 'Type Item'
        if encompassing_ti_for_all_items and encompassing_ti_for_all_items.name == "Item":
            break # No other higher-level base type
        if encompassing_ti_for_all_items is None: # Set initial 'all-encompassing' item type
            encompassing_ti_for_all_items = ti
            continue
        if hasattr(ti, 'base_types'):
            # Also handles if same / duplicate requested_search_type encountered (for some reason).
            types_list = [requested_search_type] # Self type and base types of requested_search_type
            for base_type in ti.base_types:
                types_list.append(base_type)
            for base_type in types_list:
                if encompassing_ti_for_all_items.name == base_type:
                    break # out of inner loop and continue
                if hasattr(encompassing_ti_for_all_items, "base_types") and base_type in encompassing_ti_for_all_items.base_types:
                    # Will ultimately succeed at when base_type="Item", if not any earlier.
                    encompassing_ti_for_all_items = types[base_type]
                    break # out of inner loop and continue

    search_types = [ encompassing_ti_for_all_items.name ]

    if hasattr(encompassing_ti_for_all_items, "base_types"):
        for base_type in encompassing_ti_for_all_items.base_types:
            search_types.append(base_type)

    if search_types[-1] != "Item":
        search_types.append("Item")

    return [ t + "SearchResults" for t in search_types ]


def get_collection_actions(request, type_info):
    collection = request.registry[COLLECTIONS].get(type_info.name)
    if hasattr(collection, 'actions'):
        return collection.actions(request)
    else:
        return None


def get_pagination(request):
    """
    Fill from_ and size parameters for search if given in the query string
    """
    from_ = request.normalized_params.get('from', 0)
    size = request.normalized_params.get('limit', 25)
    if size in ('all', ''):
       size = "all"
    else:
        try:
            size = int(size)
        except ValueError:
            size = 25
        try:
            from_ = int(from_)
        except ValueError:
            size = 0
    return from_, size


def get_all_subsequent_results(initial_search_result, search, extra_requests_needed_count, size_increment):
    from_ = 0
    while extra_requests_needed_count > 0:
        #print(str(extra_requests_needed_count) + " requests left to get all results.")
        from_ = from_ + size_increment
        subsequent_search = search[from_:from_ + size_increment]
        subsequent_search_result = execute_search(subsequent_search)
        extra_requests_needed_count -= 1
        for hit in subsequent_search_result['hits'].get('hits', []):
            yield hit

def execute_search_for_all_results(search):
    size_increment = 100 # Decrease this to like 5 or 10 to test.

    first_search = search[0:size_increment] # get aggregations from here
    es_result = execute_search(first_search)

    total_results_expected = es_result['hits'].get('total',0)
    extra_requests_needed_count = int(math.ceil(total_results_expected / size_increment)) - 1 # Decrease by 1 (first es_result already happened)

    if extra_requests_needed_count > 0:
        es_result['hits']['hits'] = itertools.chain(es_result['hits']['hits'], get_all_subsequent_results(es_result, search, extra_requests_needed_count, size_increment))
    return es_result


def normalize_query(request, types, doc_types):
    """
    Normalize the query by calculating and setting request.normalized_params
    (a webob MultiDict) that is derived from custom query rules and also
    the list of doc_types specified by set_doc_types(). The normalize_param
    helper function finds field_schema for each query parameter and enforces
    a set of rules (see below). If the query item types differ from doc_types,
    override with doc_types

    Args:
        request: the current Request
        types: registry[TYPES]
        doc_types (list): item_types to use for the search

    Returns:
        string: query string built from normalized params
    """
    def normalize_param(key, val):
        """
        Process each key/val in the original query param. As part of this,
        obtain the field schema for each parameter.
        Current rules:
        - for 'type', get name from types (from the registry)
        - append '.display_title' to any terminal linkTo query field
        - append '.display_title' to sorts on fields
        """
        # type param is a special case. use the name from TypeInfo
        if key == 'type' and val in types:
            return (key, types[val].name)

        # if key is sort, pass val as the key to this function
        # if it appends display title we know its a linkTo and
        # should be treated as such
        if key == 'sort':
            # do not use '-' if present
            sort_val = val[1:] if val.startswith('-') else val
            new_val, _ = normalize_param(sort_val, None)
            if new_val != sort_val:
                val = val.replace(sort_val, new_val)
            return (key, val)

        # find schema for field parameter and drill down into arrays/subobjects
        field_schema = schema_for_field(key, request, doc_types)
        while field_schema and ('items' in field_schema or 'properties' in field_schema):
            try:
                field_schema = field_schema['items']
            except KeyError:
                pass
            try:
                field_schema = field_schema['properties']
            except KeyError:
                pass
        if field_schema and 'linkTo' in field_schema:
            # add display_title to terminal linkTo query fields
            if key.endswith('!'): # handle NOT
                return (key[:-1] + '.display_title!', val)
            return (key + '.display_title', val)
        else:
            return (key, val)

    normalized_params = (
        normalize_param(k, v)
        for k, v in request.params.items()
    )
    # use a MultiDict to emulate request.params
    normalized_params = MultiDict(normalized_params)
    # overwrite 'type' if not equal to doc_types
    if set(normalized_params.getall('type')) != set(doc_types):
        if 'type' in normalized_params:
            del normalized_params['type']
        for dtype in doc_types:
            normalized_params.add('type', dtype)
    # add the normalized params to the request
    # these will be used in place of request.params for the rest of search
    setattr(request, 'normalized_params', normalized_params)
    # the query string of the normalized search
    qs = '?' + urlencode([
        (k.encode('utf-8'), v.encode('utf-8'))
        for k, v in request.normalized_params.items()
    ])
    return qs


def clear_filters_setup(request, doc_types, forced_type):
    '''
    Clear Filters URI path

    Make a URI path that clears all non-datatype filters
    and leaves in `q` (search query) params, if present.
    Also preserves currentAction=selection (or multiselect), if is set.

    Returns:
        A URL path
    '''
    seach_query_specs = request.normalized_params.getall('q')
    seach_query_url = urlencode([("q", seach_query) for seach_query in seach_query_specs])
    # types_url will always be present (always >=1 doc_type)
    types_url = urlencode([("type", typ) for typ in doc_types])
    current_action = request.normalized_params.get('currentAction')

    clear_qs = types_url or ''
    if seach_query_url:
        clear_qs += '&' + seach_query_url
    if current_action == 'selection' or current_action == 'multiselect':
        clear_qs += ('&currentAction=' + current_action)
    current_search_sort = request.normalized_params.getall('sort')
    current_search_sort_url = urlencode([("sort", s) for s in current_search_sort])
    if current_search_sort_url:
        clear_qs += '&' + current_search_sort_url
    return request.route_path(forced_type.lower(), slash='/') + (('?' + clear_qs) if clear_qs else '')


def build_type_filters(result, request, doc_types, types):
    """
    Set the type filters for the search. If no doc_types, default to Item
    """
    if not doc_types:
        doc_types = ['Item']
    else:
        for item_type in doc_types:
            ti = types[item_type]
            qs = urlencode([
                (k.encode('utf-8'), v.encode('utf-8'))
                for k, v in request.normalized_params.items() if not (k == 'type' and types.all.get('Item' if v == '*' else v) is ti)
            ])
            result['filters'].append({
                'field': 'type',
                'term': ti.name,
                'remove': '{}?{}'.format(request.path, qs)
            })


def prepare_search_term(request):
    """
    Prepares search terms by making a dictionary where the keys are fields
    and the values are arrays of query strings
    Ignore certain keywords, such as type, format, and field
    """
    prepared_terms = {}
    for field, val in request.normalized_params.items():
        if field.startswith('aggregated_items') or field == 'additional_facet':
            continue
        elif field == 'q': # searched string has field 'q'
            # people shouldn't provide multiple queries, but if they do,
            # combine them with AND logic
            if 'q' in prepared_terms:
                join_list = [prepared_terms['q'], val]
                prepared_terms['q'] = ' AND '.join(join_list)
            else:
                prepared_terms['q'] = val
        elif field not in COMMON_EXCLUDED_URI_PARAMS + ['type']:
            if 'embedded.' + field not in prepared_terms.keys():
                prepared_terms['embedded.' + field] = []
            prepared_terms['embedded.' + field].append(val)
    return prepared_terms


def set_doc_types(request, types, search_type):
    """
    Set the type of documents resulting from the search; order and check for
    invalid types as well. If a forced search_type is enforced, use that;
    otherwise, set types from the query params. Default to Item if none set.

    Args:
        request: the current Request
        types: registry[TYPES]
        search_type (str): forced search item type

    Returns:
        list: the string item types to use for the search

    Raises:
        HTTPBadRequest: if an invalid item type is supplied
    """
    doc_types = []
    if search_type is None:
        doc_types = request.params.getall('type')
        if '*' in doc_types:
            doc_types = ['Item']
    else:
        doc_types = [search_type]
    # Normalize to item_type
    try:
        doc_types = sorted({types[name].name for name in doc_types})
    except KeyError:
        # Check for invalid types
        bad_types = [t for t in doc_types if t not in types]
        msg = "Invalid type: {}".format(', '.join(bad_types))
        raise HTTPBadRequest(explanation=msg)
    if len(doc_types) == 0:
        doc_types = ['Item']
    return doc_types


def get_search_fields(request, doc_types):
    """
    Returns set of columns that are being searched and highlights
    """
    fields = {'uuid'}
    highlights = {}
    types = request.registry[TYPES]
    for doc_type in doc_types:
        type_info = types[doc_type]
        for value in type_info.schema.get('boost_values', ()):
            fields.add('embedded.' + value)
            highlights['embedded.' + value] = {}
    return fields, highlights


def list_source_fields(request, doc_types, frame):
    """
    Returns set of fields that are requested by user or default fields.
    These fields are used to further limit the results from the search.
    Note that you must provide the full fieldname with embeds, such as:
    'field=biosample.biosource.individual.organism.name' and not just
    'field=name'
    """
    fields_requested = request.normalized_params.getall('field')
    if fields_requested:
        fields = ['embedded.@id', 'embedded.@type']
        for field in fields_requested:
            fields.append('embedded.' + field)
    elif frame in ['embedded', 'object', 'raw']:
        if frame != 'embedded':
            # frame=raw corresponds to 'properties' in ES
            if frame == 'raw':
                frame = 'properties'
            # let embedded be searched as well (for faceting)
            fields = ['embedded.*', frame + '.*']
        else:
            fields = [frame + '.*']
    else:
        fields = ['embedded.*']
    return fields


def build_query(search, prepared_terms, source_fields):
    """
    Prepare the query within the Search object.
    """
    query_info = {}
    string_query = None
    # set _source fields for the search
    search = search.source(list(source_fields))
    # prepare the query from prepared_terms
    for field, value in prepared_terms.items():
        if field == 'q':
            query_info['query'] = value
            query_info['lenient'] = True
            query_info['default_operator'] = 'AND'
            query_info['fields'] = ['full_text']
            break
    if query_info != {}:
        string_query = {'must': {'simple_query_string': query_info}}
        query_dict = {'query': {'bool': string_query}}
    else:
        query_dict = {'query': {'bool':{}}}
    search.update_from_dict(query_dict)
    return search, string_query


def set_sort_order(request, search, search_term, types, doc_types, result):
    """
    sets sort order for elasticsearch results
    example: /search/?type=Biosource&sort=display_title
    will sort by display_title in ascending order. To set descending order,
    use the "-" flag: sort_by=-date_created.
    Sorting is done alphatbetically, case sensitive by default.
    TODO: add a schema flag for case sensitivity/insensitivity?

    ES5: simply pass in the sort OrderedDict into search.sort
    """
    sort = OrderedDict()
    result_sort = OrderedDict()
    if len(doc_types) == 1:
        type_schema = types[doc_types[0]].schema
    else:
        type_schema = None

    def add_to_sort_dict(requested_sort):
        if requested_sort.startswith('-'):
            name = requested_sort[1:]
            order = 'desc'
        else:
            name = requested_sort
            order = 'asc'
        sort_schema = schema_for_field(name, request, doc_types)

        if sort_schema:
            sort_type = sort_schema.get('type')
        else:
            sort_type = 'string'

        # ES type != schema types
        if sort_type == 'integer':
            sort['embedded.' + name] = result_sort[name] = {
                'order': order,
                'unmapped_type': 'long',
                'missing': '_last'
            }
        elif sort_type == 'number':
            sort['embedded.' + name] = result_sort[name] = {
                'order': order,
                'unmapped_type': 'float',
                'missing': '_last'
            }
        elif sort_schema and determine_if_is_date_field(name, sort_schema):
            sort['embedded.' + name + '.raw'] = result_sort[name] = {
                'order': order,
                'unmapped_type': 'date',
                'missing': '_last'
            }
        else:
            # fallback case, applies to all string type:string fields
            sort['embedded.' + name + '.lower_case_sort'] = result_sort[name] = {
                'order': order,
                'unmapped_type': 'keyword',
                'missing': '_last'
            }

    # Prefer sort order specified in request, if any
    requested_sorts = request.normalized_params.getall('sort')
    if requested_sorts:
        for rs in requested_sorts:
            add_to_sort_dict(rs)

    text_search = search_term.get('q')

    # Otherwise we use a default sort only when there's no text search to be ranked
    if not sort and (text_search == '*' or not text_search):
        # If searching for a single type, look for sort options in its schema
        if type_schema:
            if 'sort_by' in type_schema:
                for k, v in type_schema['sort_by'].items():
                    # Should always sort on raw field rather than analyzed field
                    # OR search on lower_case_sort for case insensitive results
                    sort['embedded.' + k + '.lower_case_sort'] = result_sort[k] = v
        # Default is most recent first, then alphabetical by label
        if not sort:
            sort['embedded.date_created.raw'] = result_sort['date_created'] = {
                'order': 'desc',
                'unmapped_type': 'keyword',
            }
            sort['embedded.label.raw'] = result_sort['label'] = {
                'order': 'asc',
                'missing': '_last',
                'unmapped_type': 'keyword',
            }
    elif not sort and text_search and text_search != '*':
        search = search.sort(                   # Multi-level sort. See http://www.elastic.co/guide/en/elasticsearch/guide/current/_sorting.html#_multilevel_sorting & https://stackoverflow.com/questions/46458803/python-elasticsearch-dsl-sorting-with-multiple-fields
            { '_score' : { "order": "desc" } },
            { 'embedded.date_created.raw' : { 'order': 'desc', 'unmapped_type': 'keyword' }, 'embedded.label.raw' : { 'order': 'asc',  'unmapped_type': 'keyword', 'missing': '_last' } },
            { '_uid' : { 'order': 'asc' } }     # 'embedded.uuid.raw' (instd of _uid) sometimes results in 400 bad request : 'org.elasticsearch.index.query.QueryShardException: No mapping found for [embedded.uuid.raw] in order to sort on'
        )
        result['sort'] = result_sort = { '_score' : { "order" : "desc" } }
        return search

    if sort and result_sort:
        result['sort'] = result_sort
        search = search.sort(sort)
    return search


def set_filters(request, search, result, principals, doc_types):
    """
    Sets filters in the query
    """

    # these next two dictionaries should each have keys equal to query_field
    # and values: must_terms: [<list of terms>], must_not_terms: [<list of terms>], add_no_value: True/False/None
    field_filters = {
        'principals_allowed.view' : {
            'must_terms': principals,
            'must_not_terms': [],
            'add_no_value': None
        },
        'embedded.@type.raw' : {
            'must_terms': doc_types,
            'must_not_terms': [],
            'add_no_value': None
        },
        'embedded.status.raw' : {
            'must_terms': [],
            'must_not_terms': [],
            'add_no_value': None
        }
    }

    range_filters = {}

    # Exclude status=deleted Items unless explicitly requested/filtered-in.
    if 'deleted' not in request.normalized_params.getall('status'):
        field_filters['embedded.status.raw']['must_not_terms'].append('deleted')
    if 'replaced' not in request.normalized_params.getall('status'):
        field_filters['embedded.status.raw']['must_not_terms'].append('replaced')

    # Exclude type=TrackingItem and type=OntologyTerm from results unless are explictly specified
    if 'TrackingItem' not in doc_types:
        field_filters['embedded.@type.raw']['must_not_terms'].append('TrackingItem')
    if 'OntologyTerm' not in doc_types:
        field_filters['embedded.@type.raw']['must_not_terms'].append('OntologyTerm')

    for field, term in request.normalized_params.items():
        not_field = False # keep track if query is NOT (!)
        exists_field = False # keep track of null values
        range_type = False # If we determine is a range request (field.to, field.from), will be populated with string 'date' or 'numerical'
        range_direction = None
        if field in COMMON_EXCLUDED_URI_PARAMS + ['q']:
            continue
        elif field == 'type' and term != 'Item':
            continue
        elif term == 'No value':
            exists_field = True

        # Check for date or numerical range filters
        if (len(field) > 3 and field[-3:] == '.to') or (len(field) > 5 and field[-5:] == '.from'):
            if field[-3:] == '.to':
                f_field = field[:-3]
                range_direction = "lte"
            else:
                f_field = field[:-5]
                range_direction = "gte"

            # If schema for field is not found (and range_type thus not set),
            # then treated as ordinary term filter (likely will get 0 results)
            field_schema = schema_for_field(f_field, request, doc_types)
            if field_schema:
                range_type = 'date' if determine_if_is_date_field(f_field, field_schema) else 'numerical'

        # Add filter to result
        qs = urlencode([
            (k.encode('utf-8'), v.encode('utf-8'))
            for k, v in request.normalized_params.items()
            if (k != field or v != term)
        ])
        remove_path = '{}?{}'.format(request.path, qs)

        # default to searching type=Item rather than empty filter path
        if remove_path[-1] == '?':
            remove_path += 'type=Item'

        result['filters'].append({
            'field' : field,
            'term'  : term,
            'remove': remove_path
        })

        # handle NOT
        if field.endswith('!'):
            field = field[:-1]
            not_field = True

        # Add filter to query
        if range_type and f_field and range_type in ('date', 'numerical'):
            query_field = 'embedded.' + f_field
        elif field.startswith('validation_errors') or field.startswith('aggregated_items'):
            query_field = field + '.raw'
        elif field == 'type':
            query_field = 'embedded.@type.raw'
        else:
            query_field = 'embedded.' + field + '.raw'


        if range_type:
            if query_field not in range_filters:
                range_filters[query_field] = {}
                if range_type == 'date':
                    range_filters[query_field]['format'] = 'yyyy-MM-dd HH:mm'

            if range_direction in ('gt', 'gte', 'lt', 'lte'):
                if range_type == "date" and len(term) == 10:
                    # Correct term to have hours, e.g. 00:00 or 23:59, if not otherwise supplied.
                    if range_direction == 'gt' or range_direction == 'lte':
                        term += ' 23:59'
                    elif range_direction == 'gte' or range_direction == 'lt':
                        term += ' 00:00'

                if range_filters[query_field].get(range_direction) is None:
                    range_filters[query_field][range_direction] = term
                else:
                    # If have a value already (e.g. multiple ranges selected), choose the widening option.
                    if range_direction == 'gt' or range_direction == 'gte':
                        if term < range_filters[query_field][range_direction]:
                            range_filters[query_field][range_direction] = term
                    elif range_direction == 'lt' or range_direction == 'lte':
                        if term > range_filters[query_field][range_direction]:
                            range_filters[query_field][range_direction] = term
        else:
            if query_field not in field_filters:
                field_filters[query_field] = {
                    'must_terms': [],
                    'must_not_terms': [],
                    'add_no_value': None
                }

            # handle case of filtering for null values
            if exists_field:
                # the value below is True when we want to include 'No value' as a filter
                field_filters[query_field]['add_no_value'] = False if not_field else True
                continue

            if not_field:
                field_filters[query_field]['must_not_terms'].append(term)
            else:
                field_filters[query_field]['must_terms'].append(term)

    must_filters = []
    must_not_filters = []
    for query_field, filters in field_filters.items():
        must_terms = {'terms': {query_field: filters['must_terms']}} if filters['must_terms'] else {}
        must_not_terms = {'terms': {query_field: filters['must_not_terms']}} if filters['must_not_terms'] else {}
        if filters['add_no_value'] is True:
            # add to must_not in an OR case, which is equivalent to filtering on 'No value'
            should_arr = [must_terms] if must_terms else []
            should_arr.append({'bool': {'must_not': {'exists': {'field': query_field}}}})
            must_filters.append({'bool': {'should': should_arr}})
        elif filters['add_no_value'] is False:
            # add to must_not in an OR case, which is equivalent to filtering on '! No value'
            should_arr = [must_terms] if must_terms else []
            should_arr.append({'exists': {'field': query_field}})
            must_filters.append({'bool': {'should': should_arr}})
        else: # no filtering on 'No value'
            if must_terms: must_filters.append(must_terms)
        if must_not_terms: must_not_filters.append(must_not_terms)

    # lastly, add range limits to filters if given
    for range_field, range_def in range_filters.items():
        must_filters.append({
            'range' : { range_field : range_def }
        })

    # To modify filters of elasticsearch_dsl Search, must call to_dict(),
    # modify that, then update from the new dict
    prev_search = search.to_dict()
    # initialize filter hierarchy
    final_filters = {'bool': {'must': must_filters, 'must_not': must_not_filters}}
    prev_search['query']['bool']['filter'] = final_filters
    search.update_from_dict(prev_search)

    return search, final_filters


def initialize_additional_facets(request, doc_types, additional_facets, append_facets, current_type_schema):
    """ Helper function for below method that handles additional_facets URL param

        :param request: current request
        :param doc_types: doc_types we are searching on
        :param additional_facets: extra facets specified
        :param append_facets: list to add additional_facets to
        :param current_type_schema: schema of the item we are faceting on
    """
    for extra_facet in additional_facets:
        aggregation_type = 'terms'  # default

        # check if defined in facets
        if 'facets' in current_type_schema:
            if extra_facet in current_type_schema['facets']:
                if not current_type_schema['facets'][extra_facet].get('disabled', False):
                    append_facets.append((extra_facet, current_type_schema['facets'][extra_facet]))
                continue  # if we found the facet, always continue from here

        # not specified as facet - infer range vs. term based on schema
        field_definition = schema_for_field(extra_facet, request, doc_types)
        if not field_definition:  # if not on schema, try "terms"
            append_facets.append((
                extra_facet, {'title': extra_facet.title()}
            ))
        else:
            t = field_definition.get('type', None)
            if not t:
                log.error('Encountered an additional facet that has no type! %s' % field_definition)
                continue  # drop this facet

            # terms for string
            if t == 'string':
                append_facets.append((
                    extra_facet, {'title': extra_facet.title(), 'aggregation_type': aggregation_type}
                ))
            else:  # try stats
                aggregation_type = 'stats'
                append_facets.append((
                    extra_facet, {
                        'title': field_definition.get('title', extra_facet.title()),
                        'aggregation_type': aggregation_type,
                        'number_step': 'any'
                    }
                ))


def initialize_facets(request, doc_types, prepared_terms, schemas, additional_facets):
    """
    Initialize the facets used for the search. If searching across multiple
    doc_types, only use the default 'Data Type' and 'Status' facets.
    Add facets for custom url filters whether or not they're in the schema

    Args:
        doc_types (list): Item types (@type) for which we are performing a search for.
        prepared_terms (dict): terms to match in ES, keyed by ES field name.
        schemas (list): List of OrderedDicts of schemas for doc_types.

    Returns:
        list: tuples containing (0) ElasticSearch-formatted field name (e.g. `embedded.status`) and (1) list of terms for it.
    """

    facets = [
        # More facets will be appended to this list from item schema plus from any currently-active filters (as requested in URI params).
        ('type', {'title': 'Data Type'})
    ]
    append_facets = [
        # Facets which will be appended after those which are in & added to `facets`
        ('status', {'title': 'Status'}),

        # TODO: Re-enable below line if/when 'range' URI param queries for date & numerical fields are implemented.
        # ('date_created', {'title': 'Date Created', 'hide_from_view' : True, 'aggregation_type' : 'date_histogram' })
    ]
    # hold disabled facets from schema; we also want to remove these from the prepared_terms facets
    disabled_facets = []

    current_type_schema = request.registry[TYPES][doc_types[0]].schema
    initialize_additional_facets(request, doc_types, additional_facets,
                                 append_facets, current_type_schema)

    # Add facets from schema if one Item type is defined.
    # Also, conditionally add extra appendable facets if relevant for type from schema.
    if len(doc_types) == 1 and doc_types[0] != 'Item':
        if 'facets' in current_type_schema:
            schema_facets = OrderedDict(current_type_schema['facets'])
            for schema_facet in schema_facets.items():
                if schema_facet[1].get('disabled', False) or schema_facet[1].get('default_hidden', False):
                    disabled_facets.append(schema_facet[0])
                    continue  # Skip disabled facets.
                facets.append(schema_facet)

    # Add facets for any non-schema ?field=value filters requested in the search (unless already set)
    used_facets = [facet[0] for facet in facets + append_facets]
    used_facet_titles = used_facet_titles = [
        facet[1]['title'] for facet in facets + append_facets
        if 'title' in facet[1]
    ]
    for field in prepared_terms:
        if field.startswith('embedded'):
            split_field = field.strip().split('.')  # Will become, e.g. ['embedded', 'experiments_in_set', 'files', 'file_size', 'from']
            use_field = '.'.join(split_field[1:])

            # 'terms' is the default per-term bucket aggregation for all non-schema facets
            aggregation_type = 'terms'

            # Use the last part of the split field to get the field title
            title_field = split_field[-1]
            # workaround: if query has a '!=' condition, title_field ends with '!'. This prevents to find the proper display title.
            # TODO: instead of workaround, '!' could be excluded while generating query results
            if title_field.endswith('!'):
                title_field = title_field[:-1]

            # if searching for a display_title, use the title of parent object
            # use `is_object_title` to keep track of this
            if title_field == 'display_title' and len(split_field) > 1:
                title_field = split_field[-2]
                is_object_title = True
            else:
                is_object_title = False

            if title_field in used_facets or title_field in disabled_facets:
                # Cancel if already in facets or is disabled
                continue
            used_facets.append(title_field)

            # If we have a range filter in the URL,
            if title_field == 'from' or title_field == 'to':
                if len(split_field) >= 3:
                    f_field = ".".join(split_field[1:-1])
                    field_schema = schema_for_field(f_field, request, doc_types)

                    if field_schema:
                        is_date_field = determine_if_is_date_field(field, field_schema)
                        is_numerical_field = field_schema['type'] in ("integer", "float", "number")

                        if is_date_field or is_numerical_field:
                            title_field = field_schema.get("title", split_field[-2])
                            use_field = f_field
                            aggregation_type = 'stats'

            for schema in schemas:
                if title_field in schema['properties']:
                    title_field = schema['properties'][title_field].get('title', title_field)
                    # see if the title field conflicts for is_object_title facets
                    if is_object_title and title_field in used_facet_titles:
                        title_field += ' (Title)'
                    break

            facet_tuple = (use_field, {'title': title_field, 'aggregation_type' : aggregation_type})

            # At moment is equivalent to `if aggregation_type == 'stats'`` until/unless more agg types are added for _facets_.
            if aggregation_type != 'terms':
                # Remove completely if duplicate (e.g. .from and .to both present)
                if use_field in used_facets:
                    continue
                #facet_tuple[1]['hide_from_view'] = True # Temporary until we handle these better on front-end.
                # Facet would be otherwise added twice if both `.from` and `.to` are requested.

            facets.append(facet_tuple)

    # Append additional facets (status ...) at the end of
    # list unless were already added via schemas, etc.
    used_facets = [ facet[0] for facet in facets ] # Reset this var
    for ap_facet in append_facets:
        if ap_facet[0] not in used_facets:
            facets.append(ap_facet)
        else: # Update with better title if not already defined from e.g. requested filters.
            existing_facet_index = used_facets.index(ap_facet[0])
            if facets[existing_facet_index][1].get('title') in (None, facets[existing_facet_index][0]):
                facets[existing_facet_index][1]['title'] = ap_facet[1]['title']

    return facets


def schema_for_field(field, request, doc_types, should_log=False):
    '''
    Find the schema for the given field (in embedded '.' format). Uses
    ff_utils.crawl_schema from snovault and logs any cases where there is an
    error finding the field from the schema. Caches results based off of field
    and doc types used

    Args:
        field (string): embedded field path, separated by '.'
        request: current Request object
        doc_types (list): @types for the search
        should_log (bool): logging will only occur if set to True

    Returns:
        Dictionary schema for the field, or None if not found
    '''
    types = request.registry[TYPES]
    schemas = [ types[dt].schema for dt in doc_types ]

    # We cannot hash dict by list (of doc_types) so we convert to unique ordered string
    doc_type_string = ','.join(doc_types)

    cache = getattr(request, '_field_schema_cache', {})
    if (field, doc_type_string) in cache:
        return cache[(field, doc_type_string)]

    field_schema = None

    # for 'validation_errors.*' and 'aggregated_items.*',
    # schema will never be found and logging isn't helpful
    if (schemas and not field.startswith('validation_errors.') and
        not field.startswith('aggregated_items.')):
        # 'type' field is really '@type' in the schema
        use_field = '@type' if field == 'type' else field
        # eliminate '!' from not fields
        use_field = use_field[:-1] if use_field.endswith('!') else use_field
        for schema in schemas:
            try:
                field_schema = crawl_schema(types, use_field, schema)
            except Exception as exc:  # cannot find schema. Log and Return None
                if should_log:
                    log.warning('Cannot find schema in search.py. Type: %s. Field: %s'
                            % (doc_types[0], field), field=field, error=str(exc))
            else:
                if field_schema is not None:
                    break

    # Cache result, even if not found, for this request.
    cache[(field, doc_type_string)] = field_schema
    if not hasattr(request, '_field_schema_cache'):
        setattr(request, '_field_schema_cache', cache)

    return field_schema


def is_linkto_or_object_array_root_field(field, types, doc_types):
    '''Not used currently. May be useful for if we want to enabled "type" : "nested" mappings on lists of dictionaries'''
    schema = types[doc_types[0]].schema
    field_root = field.split('.')[0]
    fr_schema = (schema and schema.get('properties', {}).get(field_root, None)) or None
    if fr_schema and fr_schema['type'] == 'array' and (fr_schema['items'].get('linkTo') is not None or fr_schema['items']['type'] == 'object'):
        return True
    return False


def generate_filters_for_terms_agg_from_search_filters(query_field, search_filters, string_query):
    '''
    We add a copy of our filters to each facet, minus that of
    facet's field itself so that we can get term counts for other terms filters.
    And be able to filter w/ it.

    Remove filters from fields they apply to.
    For example, the 'biosource_type' aggs should not have any
    biosource_type filter in place.
    Handle 'must' and 'must_not' filters separately

    Returns
        Copy of search_filters, minus filter for current query_field (if one set).
    '''

    facet_filters = deepcopy(search_filters['bool'])

    for filter_type in ['must', 'must_not']:
        if search_filters['bool'][filter_type] == []:
            continue
        for active_filter in search_filters['bool'][filter_type]:  # active_filter => e.g. { 'terms' : { 'embedded.@type.raw': ['ExperimentSetReplicate'] } }
            if 'bool' in active_filter and 'should' in active_filter['bool']:
                # handle No value case
                inner_bool = None
                inner_should = active_filter.get('bool').get('should', [])
                for or_term in inner_should:
                    # this may be naive, but assume first non-terms
                    # filter is the No value quqery
                    if 'terms' in or_term:
                        continue
                    else:
                        inner_bool = or_term
                        break
                if 'exists' in inner_bool:
                    compare_field = inner_bool['exists'].get('field')
                else:
                    # attempt to get the field from the alternative No value syntax
                    compare_field = inner_bool.get('bool', {}).get('must_not', {}).get('exists', {}).get('field')
                if compare_field == query_field and query_field != 'embedded.@type.raw':
                    facet_filters[filter_type].remove(active_filter)

            if 'terms' in active_filter:
                # there should only be one key here
                for compare_field in active_filter['terms'].keys():
                    # remove filter for a given field for that facet
                    # skip this for type facet (field = 'type')
                    # since we always want to include that filter.
                    if compare_field == query_field and query_field != 'embedded.@type.raw':
                        facet_filters[filter_type].remove(active_filter)

            elif 'range' in active_filter:
                for compare_field in active_filter['range'].keys():
                    # Do same as for terms
                    if compare_field == query_field:
                        facet_filters[filter_type].remove(active_filter)

    # add the string_query, if present, to the bool term with facet_filters
    if string_query and string_query['must']:
        # combine statements within 'must' for each
        facet_filters['must'].append(string_query['must'])

    return facet_filters


def set_facets(search, facets, search_filters, string_query, request, doc_types, custom_aggregations=None, size=25, from_=0):
    """
    Sets facets in the query as ElasticSearch aggregations, with each aggregation to be
    filtered by search_filters minus filter affecting facet field in order to get counts
    for other facet term options.
    ES5 - simply sets aggs by calling update_from_dict after adding them in

        :param facets:         Facet field (0) in object dot notation, and a dict or OrderedDict with title property (1).
        :type  facets:         List of tuples.
        :param search_filters: Dict of filters which are set for the ES query in set_filters
        :param string_query:   Dict holding the query_string used in the search
    """

    if from_ != 0:
        return search

    aggs = OrderedDict()

    for field, facet in facets: # E.g. 'type','experimentset_type','experiments_in_set.award.project', ...

        field_schema = schema_for_field(field, request, doc_types, should_log=True)
        is_date_field = field_schema and determine_if_is_date_field(field, field_schema)
        is_numerical_field = field_schema and field_schema['type'] in ("integer", "float", "number")

        if field == 'type':
            query_field = 'embedded.@type.raw'
        elif field.startswith('validation_errors') or field.startswith('aggregated_items'):
            query_field = field + '.raw'
        elif facet.get('aggregation_type') in ('stats', 'date_histogram', 'histogram', 'range'):
            query_field = 'embedded.' + field
        else:
            query_field = 'embedded.' + field + '.raw'


        ## Create the aggregation itself, extend facet with info to pass down to front-end
        agg_name = field.replace('.', '-')
        agg_type = facet.get('aggregation_type', 'terms')
        agg_id = agg_type + ':' + agg_name
        facet_filters = generate_filters_for_terms_agg_from_search_filters(query_field, search_filters, string_query)

        # handle stats aggregetation
        if agg_type == 'stats':

            if is_date_field:
                facet['field_type'] = 'date'
            elif is_numerical_field:
                facet['field_type'] = field_schema['type'] or "number"

            aggs[agg_id] = {
                'aggs': {
                    "primary_agg": {
                        'stats': {
                            'field': query_field
                        }
                    }
                },
                'filter': {'bool': facet_filters}
            }

        # handle range aggregation
        elif agg_type == 'range':
            ranges = [{k: v for k, v in r.items() if k in ['from', 'to']} for r in facet['ranges']]
            aggs[agg_id] = {
                'aggs': {
                    'primary_agg': {
                        'range': {
                            'field': query_field,
                            'ranges': ranges
                        }
                    }
                },
                'filter': {'bool': facet_filters}
            }

        # default - terms aggregation
        else:

            facet['aggregation_type'] = 'terms'
            term_aggregation = {
                "terms" : {
                    'size'    : 100,            # Maximum terms returned (default=10); see https://github.com/10up/ElasticPress/wiki/Working-with-Aggregations
                    'field'   : query_field,
                    'missing' : facet.get("missing_value_replacement", "No value")
                }
            }

            aggs[facet['aggregation_type'] + ":" + agg_name] = {
                'aggs': {
                    "primary_agg" : term_aggregation
                },
                'filter': {'bool': facet_filters},
            }

        # Update facet with title, description from field_schema, if missing.
        if facet.get('title') is None and field_schema and 'title' in field_schema:
            facet['title'] = field_schema['title']
        if facet.get('description') is None and field_schema and 'description' in field_schema:
            facet['description'] = field_schema['description']

    # to achieve OR behavior within facets, search among GLOBAL results,
    # not just returned ones. to do this, wrap aggs in ['all_items']
    # and add "global": {} to top level aggs query
    # see elasticsearch global aggs for documentation (should be ES5 compliant)
    search_as_dict = search.to_dict()
    search_as_dict['aggs'] = {
        'all_items': {
            'global': {},
            'aggs': aggs
        }
    }

    if size == 0:
        # Only perform aggs if size==0 requested, to improve performance for search page queries.
        # We do currently have (hidden) monthly date histogram facets which may yet to be utilized for common size!=0 agg use cases.
        set_additional_aggregations(search_as_dict, request, doc_types, custom_aggregations)

    search.update_from_dict(search_as_dict)
    return search


def set_additional_aggregations(search_as_dict, request, doc_types, extra_aggregations=None):
    '''
    Per-type aggregations may be defined in schemas. Apply them OUTSIDE of globals so they act on our current search filters.
    Warning: `search_as_dict` is modified IN PLACE.
    '''

    types = request.registry[TYPES]
    schema = types[doc_types[0]].schema

    if schema.get('aggregations'):
        for schema_agg_name in schema['aggregations'].keys():
            if schema_agg_name == 'all_items':
                raise Exception('all_items is a reserved agg name and not allowed as an extra aggregation name.')
            search_as_dict['aggs'][schema_agg_name] = schema['aggregations'][schema_agg_name]

    if extra_aggregations:
        for extra_agg_name in extra_aggregations.keys():
            if extra_agg_name == 'all_items':
                raise Exception('all_items is a reserved agg name and not allowed as an extra aggregation name.')
            search_as_dict['aggs'][extra_agg_name] = extra_aggregations[extra_agg_name]

    return search_as_dict


def execute_search(search):
    """
    Execute the given Elasticsearch-dsl search. Raise HTTPBadRequest for any
    exceptions that arise.
    Args:
        search: the Elasticsearch-dsl prepared in the search() function
    Returns:
        Dictionary search results
    """
    err_exp = None
    try:
        es_results = search.execute().to_dict()
    except ConnectionTimeout as exc:
        err_exp = 'The search failed due to a timeout. Please try a different query.'
    except RequestError as exc:
        # try to get a specific error message. May fail in some cases
        try:
            err_detail = str(exc.info['error']['root_cause'][0]['reason'])
        except Exception:
            err_detail = str(exc)
        err_exp = 'The search failed due to a request error: ' + err_detail
    except TransportError as exc:
        # most general exception
        exc_status = getattr(exc, 'status_code')
        if exc_status == 'TIMEOUT':
            err_exp = 'The search failed due to a timeout. Please try a different query.'
        else:
            err_exp = 'The search failed due to a transport error: ' + str(exc)
    except Exception as exc:
        err_exp = 'The search failed. The DCIC team has been notified.'
    if err_exp:
        raise HTTPBadRequest(explanation=err_exp)
    return es_results


def format_facets(es_results, facets, total, additional_facets, search_frame='embedded'):
    """
    Format the facets for the final results based on the es results.
    Sort based off of the 'order' of the facets
    These are stored within 'aggregations' of the result.

    If the frame for the search != embedded, return no facets
    """
    result = []
    if search_frame != 'embedded':
        return result

    # Loading facets in to the results
    if 'aggregations' not in es_results:
        return result

    aggregations = es_results['aggregations']['all_items']
    used_facets = set()

    # Sort facets by order (ascending).
    # If no order is provided, assume 0 to
    # retain order of non-explicitly ordered facets
    for field, facet in sorted(facets, key=lambda fct: fct[1].get('order', 0)):
        if facet.get('default_hidden', False) and field not in additional_facets:  # skip if specified
            continue

        result_facet = {
            'field' : field,
            'title' : facet.get('title', field),
            'total' : 0
            # To be added depending on facet['aggregation_type']: 'terms', 'min', 'max', 'min_as_string', 'max_as_string', ...
        }

        result_facet.update({ k:v for k,v in facet.items() if k not in result_facet.keys() })
        used_facets.add(field)
        field_agg_name = field.replace('.', '-')
        agg_type = facet['aggregation_type']
        full_agg_name = agg_type + ':' + field_agg_name

        if full_agg_name in aggregations:
            if agg_type == 'stats':
                result_facet['total'] = aggregations[full_agg_name]['doc_count']
                # Used for fields on which can do range filter on, to provide min + max bounds
                for k in aggregations[full_agg_name]["primary_agg"].keys():
                    result_facet[k] = aggregations[full_agg_name]["primary_agg"][k]

            elif agg_type == 'range':
                bucket_location = aggregations[full_agg_name]['primary_agg']

                # TODO - refactor ?
                # merge bucket labels from ranges into buckets
                for r in result_facet['ranges']:
                    for b in bucket_location['buckets']:

                        # if ranges match we found our bucket, propagate doc_count into 'ranges' field
                        if (r.get('from', -1) == b.get('from', -1)) and (r.get('to', -1) == b.get('to', -1)):
                            r['doc_count'] = b['doc_count']
                            break

            # 'terms' assumed
            else:
                # Default - terms, range, or histogram buckets. Buckets may not be present
                result_facet['terms'] = aggregations[full_agg_name]["primary_agg"]["buckets"]
                # Choosing to show facets with one term for summary info on search it provides
                if len(result_facet.get('terms', [])) < 1:
                    continue

            if len(aggregations[full_agg_name].keys()) > 2:
                result_facet['extra_aggs'] = { k:v for k,v in aggregations[full_agg_name].items() if k not in ('doc_count', "primary_agg") }

        result.append(result_facet)

    return result

def format_extra_aggregations(es_results):
    if 'aggregations' not in es_results:
        return {}
    return { k:v for k,v in es_results['aggregations'].items() if k != 'all_items' }


def format_results(request, hits, search_frame):
    """
    Loads results to pass onto UI
    Will retrieve the desired frame from the search hits and automatically
    add 'validation_errors' and 'aggregated_items' frames if they are present
    """
    fields_requested = request.normalized_params.getall('field')
    if fields_requested:
        frame = 'embedded'
    elif search_frame:
        frame = search_frame
    else:
        frame = 'embedded'

    if frame in ['embedded', 'object', 'raw']:
        # transform 'raw' to 'properties', which is what is stored in ES
        if frame == 'raw':
            frame = 'properties'
        for hit in hits:
            frame_result = hit['_source'][frame]
            if 'validation_errors' in hit['_source'] and 'validation_errors' not in frame_result:
                frame_result['validation_errors'] = hit['_source']['validation_errors']
            if 'aggregated_items' in hit['_source'] and 'aggregated_items' not in frame_result:
                frame_result['aggregated_items'] = hit['_source']['aggregated_items']
            yield frame_result
        return


def find_index_by_doc_types(request, doc_types, ignore):
    """
    Find the correct index(es) to be search given a list of doc_types.
    The types in doc_types are the item class names, formatted like
    'Experiment HiC' and index names are the item types, formatted like
    'experiment_hi_c'.
    Ignore any collection names provided in the ignore param, an array.
    Formats output indexes as a string usable by elasticsearch
    """
    indexes = []
    for doc_type in doc_types:
        if doc_type in ignore:
            continue
        else:
            result = find_collection_subtypes(request.registry, doc_type)
            namespaced_results = map(lambda t: get_namespaced_index(request, t), result)
            indexes.extend(namespaced_results)
    # remove any duplicates
    indexes = list(set(indexes))
    index_string = ','.join(indexes)
    return index_string


def make_search_subreq(request, path):
    subreq = make_subrequest(request, path)
    subreq._stats = getattr(request, "_stats", {})
    subreq.registry = request.registry
    if hasattr(request, "context"):
        subreq.context = request.context
    else:
        subreq.context = None
    subreq.headers['Accept'] = 'application/json'
    return subreq


def get_iterable_search_results(request, search_path='/search/', param_lists=None, **kwargs):
    '''
    Loops through search results, returns 100 (or search_results_chunk_row_size) results at a time. Pass it through itertools.chain.from_iterable to get one big iterable of results.
    TODO: Maybe make 'limit=all', and instead of calling invoke_subrequest(subrequest), instead call iter_search_results!

    :param request: Only needed to pass to do_subreq to make a subrequest with.
    :param search_path: Root path to call, defaults to /search/ (can also use /browse/).
    :param param_lists: Dictionary of param:lists_of_vals which is converted to URL query.
    :param search_results_chunk_row_size: Amount of results to get per chunk. Default should be fine.
    '''
    if param_lists is None:
        param_lists = deepcopy(DEFAULT_BROWSE_PARAM_LISTS)
    else:
        param_lists = deepcopy(param_lists)
    param_lists['limit'] = ['all']
    param_lists['from'] = [0]
    param_lists['sort'] = param_lists.get('sort','uuid')
    subreq = make_search_subreq(request, '{}?{}'.format(search_path, urlencode(param_lists, True)) )
    return iter_search_results(None, subreq, **kwargs)


# Update? used in ./batch_download.py
def iter_search_results(context, request, **kwargs):
    return search(context, request, return_generator=True, **kwargs)

def build_table_columns(request, schemas, doc_types):

    any_abstract_types = 'Item' in doc_types
    if not any_abstract_types: # Check explictly-defined types to see if any are abstract.
        type_infos = [ request.registry[TYPES][type] for type in doc_types if type != 'Item' ]
        for ti in type_infos:
            # We use `type` instead of `isinstance` since we don't want to catch subclasses.
            if type(ti) == AbstractTypeInfo:
                any_abstract_types = True
                break

    columns = OrderedDict()

    # Add title column, at beginning always
    columns['display_title'] = {
        "title" : "Title",
        "order" : -100
    }

    # Add type column if any abstract types in search
    current_action = request.normalized_params.get('currentAction')
    if any_abstract_types and current_action != 'selection' and current_action != 'multiselect':
        columns['@type'] = {
            "title" : "Item Type",
            "colTitle" : "Type",
            "order" : -80,
            "description" : "Type or category of Item",
            # Alternative below, if we want type column to be available but hidden by default in selection mode:
            # "default_hidden": request.normalized_params.get('currentAction') == 'selection'
        }

    for schema in schemas:
        if 'columns' in schema:
            schema_columns = OrderedDict(schema['columns'])
            # Add all columns defined in schema
            for name, obj in schema_columns.items():
                if name not in columns:
                    columns[name] = obj
                else:
                    # If @type or display_title etc. column defined in schema, then override defaults.
                    for prop in schema_columns[name]:
                        columns[name][prop] = schema_columns[name][prop]
                # Add description from field schema, if none otherwise.
                if not columns[name].get('description'):
                    field_schema = schema_for_field(name, request, doc_types)
                    if field_schema:
                        if field_schema.get('description') is not None:
                            columns[name]['description'] = field_schema['description']

    # Add status column, if not present, at end.
    if 'status' not in columns:
        columns['status'] = {
            "title"             : "Status",
            "default_hidden"    : True,
            "order"             : 501
        }
    # Add created date column, if not present, at end.
    if 'date_created' not in columns:
        columns['date_created'] = {
            "title"             : "Date Created",
            "default_hidden"    : True,
            "order"             : 510
        }
    # Add modified date column, if not present, at end.   
    if 'last_modified.date_modified' not in columns:
        columns['last_modified.date_modified'] = {
            "title"             : "Date Modified",
            "default_hidden"    : True,
            "order"             : 520
        }
    return columns

_ASSEMBLY_MAPPER = {
    'GRCh38-minimal': 'hg38',
    'GRCh38': 'hg38',
    'GRCh37': 'hg19',
    'GRCm38': 'mm10',
    'GRCm37': 'mm9',
    'BDGP6': 'dm4',
    'BDGP5': 'dm3',
    'WBcel235': 'WBcel235'
}

hgConnect = ''.join([
    'http://genome.ucsc.edu/cgi-bin/hgTracks',
    '?hubClear=',
])
