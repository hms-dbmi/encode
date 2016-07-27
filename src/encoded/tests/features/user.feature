Feature: User Profile

    Scenario Outline: View profile
        When I visit "/"
        And I click the link with text that contains "Account"
        And I click the link with text that contains "Profile"
        Then I should see "J. Michael Cherry, Stanford"
        And I should see an element with the css selector ".access-keys"
