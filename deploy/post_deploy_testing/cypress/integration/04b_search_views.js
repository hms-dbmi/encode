

describe('Post-Deployment Search View Tests', function () {

    context('/search/?type=Item', function () {

        before(function(){
            cy.visit('/search/');
        });

        beforeEach(function(){
            // Ensure we preserve search session cookie for proper ordering.
            Cypress.Cookies.preserveOnce("searchSessionID");
        });

        it('Load as you scroll works for ?type=Item', function () {

            cy.location('search').should('include', 'type=Item');

            cy.searchPageTotalResultCount().then((totalCountExpected)=>{
                const intervalCount = Math.min(20, parseInt(totalCountExpected / 25));

                for (let interval = 0; interval < intervalCount; interval++){
                    cy.scrollToBottom().then(()=>{
                        cy.get('.search-results-container .search-result-row[data-row-number="' + (25 * (interval + 1)) + '"]').should('have.length', 1);
                    });
                }

            });

        });

    });


    context('q=olfactory results are consistently ordered', function(){

        before(function(){
            cy.visit('/search/');
        });

        beforeEach(function(){
            // Ensure we preserve search session cookie for proper ordering.
            Cypress.Cookies.preserveOnce("searchSessionID");
        });

        it('Starting from /search/, typing "olfactory" into searchbox redirects back to search', function(){

            cy.searchPageTotalResultCount().should('be.greaterThan', 100).then(function(origResultCount){
                return cy.get('input[name="q"]').focus().clear().type('olfactory').wait(10).end()
                    .get('form.navbar-search-form-container').submit().end()
                    .location('search').should('include', 'q=olfactory').end()
                    .searchPageTotalResultCount().should('be.lessThan', origResultCount).end();
            });

        });

        it('Can scroll all the way down without interruption', function(){

            cy.searchPageTotalResultCount().should('be.greaterThan', 50).should('be.lessThan', 30000).then((resultCount)=>{
                const intervalCount = parseInt(resultCount / 25) - ( resultCount % 25 > 0 ? 0 : 1); // Skip last interval if no more to load.

                for (let interval = 0; interval < intervalCount; interval++){
                    cy.scrollToBottom().end().get('.search-results-container .search-result-row[data-row-number="' + (25 * (interval + 1)) + '"]').should('have.length', 1);
                }
            });

        });


    });

});
