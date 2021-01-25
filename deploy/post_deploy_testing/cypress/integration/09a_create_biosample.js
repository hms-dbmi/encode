
import { navUserAcctDropdownBtnSelector } from './../support/variables';

/**
* Test you can visit the Biosample create page.
*/
describe('Biosample create page', function () {

    context('Cypress test user profile create biosample page', function () {

        var testItemsToDelete = [];
        it('Main page visit', function () {
            cy.visit('/');
        });

        it('Ensure logged in, visit biosample create page ', function () {

            // Login CypressTest user
            cy.login4DN({ 'email': 'u4dntestcypress@gmail.com' }).end()
                .get(navUserAcctDropdownBtnSelector).then((accountListItem) => {
                    expect(accountListItem.text()).to.contain('Cypress');
                }).end();
            cy.visit('/search/?type=Biosample').get(".above-results-table-row .btn").should('contain', 'Create New')
                .get("a.btn.btn-primary.btn").should('contain', 'Create New').click().end().wait(1000);

            // Submit create biosample data name
            const identifier = ("bs-test-" + new Date().getTime());
            cy.get('.modal-dialog input#aliasInput.form-control').focus().type(identifier).wait(100).end()
                .get("button.btn-primary.btn").should('contain', 'Submit').click().end().wait(1000);

            // Add biosources data file
            cy.get(".field-row[data-field-name=biosource] .dropdown-toggle").click().wait(100)
                .get(".field-row[data-field-name=biosource] .search-selection-menu-body .text-input-container input.form-control")
                .type("0f011b1e-b772-4f2a-8c24-cc55de28a994").wait(1000)
                .get(".field-row[data-field-name=biosource] .search-selection-menu-body .scroll-items .dropdown-item")
                .should('have.length', 1).click().wait(1000).end();

            // Click Validate button
            cy.get(".action-buttons-container .btn")
                .within(function () {
                    return cy.contains('Validate').click().end().wait(1000);
                }).end()
                //Click Submit button
                .get(".action-buttons-container .btn").within(function () {
                    return cy.contains('Submit').click().end().wait(500);
                }).end()
                //Navigate new biosample data page
                .get(".action-buttons-container .btn").within(function () {
                    return cy.contains('Skip').click().end();
                })
                .end()
                .get("h1.page-title").contains("Biosample").wait(1000).end(); // Await until are at Biosample page. Then wait 1s to ensure we have new context.

            // Queue for deletion in subsequent test.
            cy.get('script[data-prop-name=context]').then(function($context){
                const context = $context.text();
                const contextData = JSON.parse(context);
                const atId = contextData['@id'];
                testItemsToDelete.push(atId);//Test biosample data @id
            });

        });


        it('Biosample delete data', function () {

            // Log in _as admin_.
            cy.visit('/').login4DN({ 'email': '4dndcic@gmail.com', 'useEnvToken': true }).wait(1000);

            // Delete item biosample data.
            cy.wrap(testItemsToDelete).each(function (testItemURL) { // Synchronously process async stuff.
                console.log('DELETING', testItemURL);
                cy.window().then(function (w) {
                    const token = w.fourfront.JWT.get();
                    cy.request({
                        method: "DELETE",
                        url: testItemURL,
                        headers: {
                            'Authorization': 'Bearer ' + token,
                            "Content-Type": "application/json",
                            "Accept": "application/json"
                        }
                    }).end().request({
                        method: "PATCH",
                        url: testItemURL,
                        headers: {
                            'Authorization': 'Bearer ' + token,
                            "Content-Type": "application/json",
                            "Accept": "application/json"
                        },
                        body: JSON.stringify({ "tags": ["deleted_by_cypress_test"] })
                    });
                });
            });

            // Empty the array now that we're done.
            testItemsToDelete = [];
        });
    });
});


