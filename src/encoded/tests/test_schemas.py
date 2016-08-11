import pytest
from pkg_resources import resource_listdir
from snovault.schema_utils import load_schema

SCHEMA_FILES = [
    f for f in resource_listdir('encoded', 'schemas')
    if f.endswith('.json')
]

@pytest.fixture(scope='module')
def master_mixins():
    return load_schema('encoded:schemas/mixins.json')

@pytest.mark.parametrize('schema', SCHEMA_FILES)
def test_load_schema(schema, master_mixins):
    loaded_schema = load_schema('encoded:schemas/%s' % schema)
    assert(loaded_schema)

    #check the mixin properties for each schema
    if not schema == ('mixins.json'):
        verify_mixins(loaded_schema, master_mixins)

def verify_mixins(loaded_schema, master_mixins):
    '''
    test to ensure that we didn't accidently overwrite mixins somehow
    '''
    for mixin in loaded_schema.get('mixinProperties',[]):
        # get the mixin name from {'$ref':'mixins.json#/schema_version'}
        mixin_file_name, mixin_name = mixin['$ref'].split('/')
        if mixin_file_name != "mixins.json":
            #skip any mixins not in main mixins.json
            continue
        mixin_schema = master_mixins[mixin_name]

        #each field in the mixin should be present in the parent schema with same properties
        for mixin_field_name, mixin_field in mixin_schema.items():
            schema_field = loaded_schema['properties'][mixin_field_name]
            for key in mixin_field.keys():
                assert mixin_field[key] == schema_field[key]


def test_linkTo_saves_uuid(root, submitter, lab):
    item = root['users'][submitter['uuid']]
    assert item.properties['submits_for'] == [lab['uuid']]


def test_mixinProperties():
    from snovault.schema_utils import load_schema
    schema = load_schema('encoded:schemas/access_key.json')
    assert schema['properties']['uuid']['type'] == 'string'


def test_dependencies(testapp):
    collection_url = '/testing-dependencies/'
    testapp.post_json(collection_url, {'dep1': 'dep1', 'dep2': 'dep2'}, status=201)
    testapp.post_json(collection_url, {'dep1': 'dep1'}, status=422)
    testapp.post_json(collection_url, {'dep2': 'dep2'}, status=422)
    testapp.post_json(collection_url, {'dep1': 'dep1', 'dep2': 'disallowed'}, status=422)


def test_page_schema_validates_parent_is_not_collection_default_page(testapp):
    res = testapp.post_json('/pages/', {'name': 'biosamples', 'title': 'Biosamples'})
    uuid = res.json['@graph'][0]['@id']
    testapp.post_json('/pages/', {'parent': uuid, 'name': 'test', 'title': 'Test'}, status=422)


def test_changelogs(testapp, registry):
    from snovault import TYPES
    for typeinfo in registry[TYPES].by_item_type.values():
        changelog = typeinfo.schema.get('changelog')
        if changelog is not None:
            res = testapp.get(changelog)
            assert res.status_int == 200, changelog
            assert res.content_type == 'text/markdown'


def test_schemas_etag(testapp):
    etag = testapp.get('/profiles/', status=200).etag
    assert etag
    testapp.get('/profiles/', headers={'If-None-Match': etag}, status=304)
