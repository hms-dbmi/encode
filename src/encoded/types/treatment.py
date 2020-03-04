"""The type file for the collection Treatment."""
from snovault import (
    abstract_collection,
    calculated_property,
    collection,
    load_schema,
)
# from pyramid.security import Authenticated
from .base import (
    Item,
    ALLOW_SUBMITTER_ADD,
    lab_award_attribution_embed_list,
    get_item_if_you_can
)


@abstract_collection(
    name='treatments',
    acl=ALLOW_SUBMITTER_ADD,
    properties={
        'title': "Treatments",
        'description': 'Listing of all types of treatments.',
    })
class Treatment(Item):
    """Treatment class."""
    item_type = 'treatment'
    base_types = ['Treatment'] + Item.base_types
    schema = load_schema('encoded:schemas/treatment.json')
    embedded_list = Item.embedded_list + lab_award_attribution_embed_list


@collection(
    name='treatments-agent',
    properties={
        'title': 'Treatments-Agentbased',
        'description': 'Listing Physical or Chemical Treatments',
    })
class TreatmentAgent(Treatment):
    """Subclass of treatment for physical/chemical treatments."""

    item_type = 'treatment_agent'
    schema = load_schema('encoded:schemas/treatment_agent.json')
    embedded_list = Treatment.embedded_list + ['constructs.name']

    @calculated_property(schema={
        "title": "Display Title",
        "description": "A calculated title for every object in 4DN",
        "type": "string"
    })
    def display_title(self, request, treatment_type=None, chemical=None,
                      biological_agent=None, constructs=None, duration=None,
                      duration_units=None, concentration=None,
                      concentration_units=None, temperature=None):
        conditions = ""
        if concentration and concentration_units:
            conditions += str(concentration) + " " + concentration_units
        if duration and duration_units:
            if conditions:
                conditions += ", "
            conditions += str(duration) + duration_units[0]
        if temperature:
            if conditions:
                conditions += " "
            conditions += "at " + str(temperature) + "°C"
        if conditions:
            conditions = " (" + conditions + ")"

        if chemical:
            action = "treatment" if concentration != 0 else "washout"
            disp_title = chemical + " " + action + conditions
        elif treatment_type == "Transient Transfection" and constructs:
            plasmids = ", ".join(
                [get_item_if_you_can(request, construct).get('name') for construct in constructs]
            )
            disp_title = "Transient transfection of " + plasmids + conditions
        elif treatment_type == "Biological" and biological_agent:
            disp_title = biological_agent + " treatment" + conditions
        elif treatment_type == "Other":
            disp_title = "Other treatment" + conditions
        else:
            disp_title = treatment_type + conditions
        return disp_title


@collection(
    name='treatments-rnai',
    properties={
        'title': 'Treatments-RNAi',
        'description': 'Listing RNAi Treatments',
    })
class TreatmentRnai(Treatment):
    """Subclass of treatment for RNAi treatments."""

    item_type = 'treatment_rnai'
    schema = load_schema('encoded:schemas/treatment_rnai.json')
    embedded_list = Treatment.embedded_list + [
        'rnai_vendor.name',
        'constructs.designed_to_target',
    ]

    @calculated_property(schema={
        "title": "Display Title",
        "description": "A calculated title for every object in 4DN",
        "type": "string"
    })
    def display_title(self, request, rnai_type=None, target=None):
        if rnai_type and target:
            tstring = ''
            for t in target:
                target = request.embed(t, '@@object')
                tstring += '{}, '.format(target['display_title'])
            rnai_value = rnai_type + " of " + tstring[:-2]
        else:
            rnai_value = rnai_type + " treatment"
        return rnai_value
