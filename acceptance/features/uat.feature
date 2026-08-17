@daily @uat @web
Feature: Daily acceptance of the fuchi-no-dokuneko project index
  The daily laptop verifies every project category, destination metadata,
  local media, and the organized and raw update logs.

  Background:
    Given I open the web application at path "/"
    Then the web page title contains "Projects"
    And exactly 9 elements match CSS "#projects article"

  Scenario: Filter every project category and restore the full directory
    Then CSS "#resultCount" contains text "Showing all 9 projects"
    When I click CSS "[data-filter='web']"
    Then CSS "#resultCount" contains text "Showing 5 web projects"
    And exactly 5 elements match CSS "#projects article:not([hidden])"
    When I click CSS "[data-filter='android']"
    Then CSS "#resultCount" contains text "Showing 3 android projects"
    And exactly 3 elements match CSS "#projects article:not([hidden])"
    When I click CSS "[data-filter='learning']"
    Then CSS "#resultCount" contains text "Showing 3 learning projects"
    And exactly 3 elements match CSS "#projects article:not([hidden])"
    When I click CSS "[data-filter='all']"
    Then CSS "#resultCount" contains text "Showing all 9 projects"
    And exactly 9 elements match CSS "#projects article:not([hidden])"

  Scenario: Present local project imagery and source or release destinations
    Then JavaScript expression "Array.from(document.images).every((image) => !image.getAttribute('src').startsWith('http') && image.naturalWidth > 0)" returns true
    And JavaScript expression "Array.from(document.querySelectorAll('#projects article')).every((card) => card.querySelectorAll('.actions a').length === 2)" returns true
    And JavaScript expression "Array.from(document.querySelectorAll('#projects .actions a:last-child')).every((link) => link.href.startsWith('https://github.com/fuchi-no-dokuneko/'))" returns true
    And JavaScript expression "Boolean(document.querySelector('a[href=\"https://tensor-playground-research.pages.dev\"]'))" returns true
    And JavaScript expression "Boolean(document.querySelector('a[href=\"https://github.com/fuchi-no-dokuneko/playground\"]'))" returns true
    And exactly 2 elements match CSS "a.button-link[href='updates.html']"

  Scenario: Open the organized updates and retain access to raw Markdown
    When I click CSS "header a[href='updates.html']"
    Then the web path ends with "updates.html"
    And the web page title contains "Updates"
    And exactly 5 elements match CSS ".log-day"
    And at least 9 elements match CSS ".log-entry"
    And CSS ".log-list" contains text "UsefulTool"
    And CSS ".log-list" contains text "WAFUSTUDYSHIELD"
    And CSS ".log-list" contains text "TODODIARY"
    When I click CSS "a[href='updates.md']"
    Then the web path ends with "updates.md"
