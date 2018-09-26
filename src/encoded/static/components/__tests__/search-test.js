'use strict';

/* Written by Carl, test for search.js (used for objs such as expts and
biosources). Test data captured from Nov. 2016 metadata.*/

jest.autoMockOff();

// Fixes https://github.com/facebook/jest/issues/78
jest.dontMock('react');
jest.dontMock('underscore');


function filterRowsToResults(rows){
    return rows.filter(function(r){
        if (r.className.indexOf('fin') > -1) return false;
        if (r.className.indexOf('empty-block') > -1) return false;
        if (r.className.indexOf('loading') > -1) return false;
        return true;
    });
}


describe('Testing search.js', function() {
    var sinon, server;
    var React, SearchView, searchViewCommonProps, testSearch, TestUtils, context, schemas, _;

    beforeEach(function() {
        React = require('react');
        TestUtils = require('react-dom/lib/ReactTestUtils');
        _ = require('underscore');
        SearchView = require('./../browse/SearchView').default;
        context = require('../testdata/expt_search');

        sinon = require('sinon');
        server = sinon.fakeServer.create();

        server.respondWith(
            "GET",
            '/profiles/',
            [
                200, 
                { "Content-Type" : "application/json" },
                '<html></html>' // Don't actually need content JSON here for test.
            ]
        );

        searchViewCommonProps = {
            "href" : "/search/?type=ExperimentHiC",

            // Mocked props that would be sent from app.BodyElement
            "windowWidth" : 1000,
            "registerWindowOnScrollHandler" : function(fxn){
                setTimeout(()=> console.log(fxn(345, 345)), 2000);
                setTimeout(()=> console.log(fxn(40, -305)), 5000);
                console.log("Will call `fxn` in 2 & 5 seconds and print their return val. Fine if 'undefined'.");
                jest.runAllTimers();
            }
        };

        testSearch = TestUtils.renderIntoDocument(
            <SearchView {...searchViewCommonProps} context={context} />
        );

    });

    it('has the correct number of facets and experiment accessions listed', function() {
        var facets = TestUtils.scryRenderedDOMComponentsWithClass(testSearch, 'facet');
        var rows = TestUtils.scryRenderedDOMComponentsWithClass(testSearch, 'search-result-row');
        var results = filterRowsToResults(rows);

        var facetFields = facets.map(function(f){ return f.getAttribute('data-field'); });
        console.log("Facets shown for:", facetFields.join(', '));
        expect(facets.length).toBeGreaterThan(7);
        expect(results.length).toEqual(5);
    });

    it('facets properly (digestion_enzyme=hindIII)', function() {
        context = require('../testdata/expt_search_hindIII');
        testSearch = TestUtils.renderIntoDocument(
            <SearchView {...searchViewCommonProps} context={context} href='/search/?type=ExperimentHiC&digestion_enzyme.name=HindIII' />
        );
        var rows = TestUtils.scryRenderedDOMComponentsWithClass(testSearch, 'search-result-row');
        var results = filterRowsToResults(rows);
        var selectedFacets = TestUtils.scryRenderedDOMComponentsWithClass(testSearch, 'selected');
        expect(results.length).toEqual(2);
        expect(selectedFacets.length).toEqual(2);
    });
});
