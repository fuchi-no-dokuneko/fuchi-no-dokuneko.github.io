@demo @english @web
Feature: English key-feature demonstration of the project index

  Scenario: Find Android apps and review feature updates
    Given I begin a recorded demo
    And I open the web application at path "/"
    When I narrate in "en-US" for at least 8 seconds:
      """
      This project index gathers the public browser tools, Android applications, and learning projects in one scannable directory, with direct app and source links on each entry.
      """
    And I click CSS "[data-filter='android']"
    Then CSS "#resultCount" contains text "Showing 3 android projects"
    And exactly 3 elements match CSS "#projects article:not([hidden])"
    When I narrate in "en-US" for at least 6 seconds:
      """
      Category filters narrow the directory immediately. Here the Android view contains RecorderLong, TodoDiary, and WafuStudyShield.
      """
    And I click CSS "header a[href='updates.html']"
    Then the web path ends with "updates.html"
    And at least 1 elements match CSS ".log-day"
    When I narrate in "en-US" for at least 8 seconds:
      """
      View updates opens a short, feature-focused log grouped by date and repository, written for normal users instead of as a raw commit history.
      """
    Then I finish the recorded demo
