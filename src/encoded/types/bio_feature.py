"""The type file for the collection BioFeature.
"""
from snovault import (
    calculated_property,
    collection,
    load_schema,
)
from .base import (
    Item,
    lab_award_attribution_embed_list,
    get_item_or_none
)


@collection(
    name='bio-features',
    properties={
        'title': 'Biological Features',
        'description': 'Listing of BioFeature Items',
    })
class BioFeature(Item):
    """BioFeature class."""

    item_type = 'bio_feature'
    schema = load_schema('encoded:schemas/bio_feature.json')
    embedded_list = Item.embedded_list + lab_award_attribution_embed_list + [
        'feature_type.preferred_name',
    ]

    @calculated_property(schema={
        "title": "Display Title",
        "description": "A calculated title for every object in 4DN",
        "type": "string"
    })
    def display_title(self, request, feature_type, preferred_label=None, cellular_structure=None,
                      organism_name=None, relevant_genes=[], feature_mods=[], genome_location=[]):

        featstr = ''
        modstr = ''
        orgstr = ''
        if organism_name and organism_name != 'human':
            orgstr = organism_name
        if preferred_label:
            if orgstr:
                orgstr = ' (' + orgstr + ')'
            return preferred_label + orgstr
        ftype = get_item_or_none(request, feature_type)
        ftype = ftype.get('preferred_name', '') if ftype is not None else ''

        # first pass will not assume combined fields
        if ftype == 'cellular_component':
            if not cellular_structure:
                cellular_structure = 'unspecified cellular component'
            return cellular_structure

        # gene trumps location
        for g in relevant_genes:
            gene = get_item_or_none(request, g)
            if gene is not None:
                symb = gene.get('display_title')
                featstr = featstr + symb + ', '

        # check for mods
        for mod in feature_mods:
            if mod.get('mod_position'):
                modstr += (mod.get('mod_position') + ' ')
            modstr += (mod.get('mod_type') + ', ')
        if modstr:
            modstr = 'with ' + modstr[:-2]

        # if no genes use genome location
        if not relevant_genes:
            for loc in genome_location:
                try:
                    locstr = get_item_or_none(request, loc).get('display_title')
                except AttributeError:
                    pass
                else:
                    featstr += (locstr + ', ')
        if featstr:
            featstr = featstr[:-2]
            if ', ' in featstr:
                ftype += 's'
        if orgstr:
            if 'multiple' in orgstr:
                return ' '.join([featstr, ftype, orgstr, modstr]).strip()
            else:
                featstr += ' {}'.format(orgstr)
        return ' '.join([featstr, ftype, modstr]).strip()
