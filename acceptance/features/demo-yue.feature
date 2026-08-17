@demo @cantonese @web
Feature: 專案索引粵語主要功能示範

  Scenario: 尋找 Android 應用程式及查看功能更新
    Given I begin a recorded demo
    And I open the web application at path "/"
    When I narrate in "yue-HK" for at least 8 seconds:
      """
      呢個專案索引將公開瀏覽器工具、Android 應用程式同學習專案集中喺一個容易瀏覽嘅目錄，每個項目都有直接開啟同原始碼連結。
      """
    And I click CSS "[data-filter='android']"
    Then CSS "#resultCount" contains text "Showing 3 android projects"
    And exactly 3 elements match CSS "#projects article:not([hidden])"
    When I narrate in "yue-HK" for at least 6 seconds:
      """
      分類按鈕會即時收窄項目。Android 畫面而家會顯示 RecorderLong、TodoDiary 同 WafuStudyShield。
      """
    And I click CSS "header a[href='updates.html']"
    Then the web path ends with "updates.html"
    And at least 1 elements match CSS ".log-day"
    When I narrate in "yue-HK" for at least 8 seconds:
      """
      查看更新會打開按日期同專案整理嘅簡短功能紀錄，內容係寫畀一般使用者睇，而唔係原始提交歷史。
      """
    Then I finish the recorded demo
