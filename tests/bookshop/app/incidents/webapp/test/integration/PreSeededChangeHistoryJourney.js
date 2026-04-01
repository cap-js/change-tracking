/* global QUnit */
sap.ui.define(["sap/ui/test/opaQunit"], function (opaTest) {
  "use strict";

  /**
   * Journey B: Pre-seeded Change History
   *
   * A support agent opens an incident ("No current on a sunny day")
   * that already has change history entries from the CSV seed data.
   * Verifies the entries are displayed correctly with the expected
   * object ID and object type.
   */
  var Journey = {
    run: function () {
      QUnit.module("Pre-seeded Change History");

      opaTest(
        "Navigate to 'No current on a sunny day'",
        function (Given, When, Then) {
          When.onTheMainPage
            .onTable()
            .iPressRow({ Title: "No current on a sunny day" });
          Then.onTheDetailPage.iSeeThisPage();
        }
      );

      opaTest(
        "Change History shows pre-seeded entries",
        function (Given, When, Then) {
          // Section expand state persists from previous journey
          When.onTheDetailPage.iGoToSection("Change History");

          Then.onTheDetailPage.iSeeChangeHistoryEntries(1);
          Then.onTheDetailPage.iSeeChangeHistoryRow({
            objectID: "Stormy Weathers",
            objectType: "Support Incidents",
          });
        }
      );

      opaTest(
        "Navigate back to List Report",
        function (Given, When, Then) {
          When.iNavigateBack();
          Then.onTheMainPage.iSeeThisPage();
        }
      );
    },
  };

  return Journey;
});
