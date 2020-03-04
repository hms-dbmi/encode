import pytest
pytestmark = [pytest.mark.setone, pytest.mark.working, pytest.mark.schema]


@pytest.fixture
def drug_treatment(testapp, lab, award):
    item = {
        'award': award['@id'],
        'lab': lab['@id'],
        'treatment_type': 'Chemical',
        'chemical': 'Drug',
    }
    return testapp.post_json('/treatment_agent', item).json['@graph'][0]


@pytest.fixture
def viral_treatment(testapp, lab, award):
    item = {
        'award': award['@id'],
        'lab': lab['@id'],
        'treatment_type': 'Biological',
        'biological_agent': 'Virus',
    }
    return testapp.post_json('/treatment_agent', item).json['@graph'][0]


@pytest.fixture
def heatshock_treatment(testapp, lab, award):
    item = {
        'award': award['@id'],
        'lab': lab['@id'],
        'treatment_type': 'Heat Shock',
    }
    return testapp.post_json('/treatment_agent', item).json['@graph'][0]


def test_calculated_agent_treatment_display_title(testapp, heatshock_treatment):
    assert heatshock_treatment['display_title'] == 'Heat Shock'
    res = testapp.patch_json(
        heatshock_treatment['@id'],
        {'duration': 3.5, 'duration_units': 'hour'})
    assert res.json['@graph'][0]['display_title'] == 'Heat Shock (3.5h)'
    res = testapp.patch_json(heatshock_treatment['@id'], {'temperature': 42})
    assert res.json['@graph'][0]['display_title'] == 'Heat Shock (3.5h at 42°C)'


def test_calculated_agent_treatment_display_title_other_treatment(testapp, heatshock_treatment):
    res = testapp.patch_json(
        heatshock_treatment['@id'], {'treatment_type': 'Other'}).json['@graph'][0]
    assert res.get('display_title') == 'Other treatment'


def test_calculated_chemical_treatment_display_title(testapp, drug_treatment):
    assert drug_treatment['display_title'] == 'Drug treatment'
    res = testapp.patch_json(
        drug_treatment['@id'],
        {'duration': 3.5, 'duration_units': 'hour'})
    assert res.json['@graph'][0]['display_title'] == 'Drug treatment (3.5h)'
    res = testapp.patch_json(
        drug_treatment['@id'],
        {'concentration': 3.5, 'concentration_units': 'M'})
    assert res.json['@graph'][0]['display_title'] == 'Drug treatment (3.5 M, 3.5h)'
    res = testapp.patch_json(drug_treatment['@id'], {'temperature': 3.5})
    assert res.json['@graph'][0]['display_title'] == 'Drug treatment (3.5 M, 3.5h at 3.5°C)'


def test_calculated_chemical_treatment_display_title_temp_only(testapp, drug_treatment):
    assert drug_treatment['display_title'] == 'Drug treatment'
    res = testapp.patch_json(drug_treatment['@id'], {'temperature': 37})
    assert res.json['@graph'][0]['display_title'] == 'Drug treatment (at 37°C)'


def test_calculated_chemical_treatment_washout_display_title(testapp, drug_treatment):
    assert drug_treatment['display_title'] == 'Drug treatment'
    res = testapp.patch_json(
        drug_treatment['@id'],
        {'duration': 3.5, 'duration_units': 'hour', 'concentration': 0, 'concentration_units': 'M'}
    )
    assert res.json['@graph'][0]['display_title'] == 'Drug washout (3.5h)'


def test_calculated_biological_treatment_display_title(testapp, viral_treatment):
    assert viral_treatment['display_title'] == 'Virus treatment'
    res = testapp.patch_json(viral_treatment['@id'], {
        'duration': 3.5, 'duration_units': 'hour',
        'concentration': 2, 'concentration_units': 'MOI'
    })
    assert res.json['@graph'][0]['display_title'] == 'Virus treatment (2 MOI, 3.5h)'


def test_calculated_rnai_treatment_display_title(testapp, rnai, gene_bio_feature):
    assert rnai['display_title'] == 'shRNA treatment'
    res = testapp.patch_json(rnai['@id'], {'target': [gene_bio_feature['@id']]})
    assert res.json['@graph'][0]['display_title'] == 'shRNA of RAD21 gene'
