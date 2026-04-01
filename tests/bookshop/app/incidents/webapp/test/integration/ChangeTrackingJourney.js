/* global QUnit */
sap.ui.define(["sap/ui/test/opaQunit"], function (opaTest) {
  "use strict";

  var Journey = {
    start: function () {
      QUnit.module("Change Tracking OPA Tests");

      opaTest("#000: Start the app", function (Given) {
        Given.iStartMyApp();
      });

      return Journey;
    },

    /**
     * Tests using pre-seeded CSV data to verify structural aspects
     * of the Change History section (visibility, columns, entries).
     */
    testPreSeededData: function () {
      opaTest(
        "#1: List Report page loads correctly",
        function (Given, When, Then) {
          Then.onTheMainPage.iSeeThisPage();
        }
      );

      opaTest(
        "#2: Navigate to Incident with pre-seeded change history",
        function (Given, When, Then) {
          // Navigate to "Solar panel broken" which has pre-seeded Changes data
          When.onTheMainPage
            .onTable()
            .iPressRow({ Title: "Solar panel broken" });
          Then.onTheDetailPage.iSeeThisPage();
        }
      );

      opaTest(
        "#3: Change History section is visible on the Object Page",
        function (Given, When, Then) {
          // The change-tracking plugin injects a "Change History" section
          // via the ChangeHistoryFacet on all @changelog-annotated entities
          Then.onTheDetailPage.iSeeChangeHistorySection();
        }
      );

      opaTest(
        "#4: Change History section has the expected columns",
        function (Given, When, Then) {
          // Navigate to the Change History section to load its data
          // (it uses @UI.PartOfPreview: false, so data loads on demand)
          When.onTheDetailPage.iGoToSection("Change History");

          // Expand the collapsed subsection by clicking "Show More"
          When.onTheDetailPage.iPressSeeMore();

          // Verify all expected columns are present
          Then.onTheDetailPage.iSeeChangeHistoryColumns([
            "Change Type",
            "Object Type",
            "Object ID",
            "Field",
            "New Value",
            "Old Value",
            "Changed at",
            "Changed by",
          ]);
        }
      );

      opaTest(
        "#5: Change History displays pre-seeded entries",
        function (Given, When, Then) {
          // Verify that pre-seeded changelog data is visible in the table
          Then.onTheDetailPage.iSeeChangeHistoryEntries(1);

          // Verify specific content from our pre-seeded CSV data
          Then.onTheDetailPage.iSeeChangeHistoryEntryWith({
            objectID: "Sunny Sunshine",
          });
        }
      );

      opaTest(
        "#5b: Change History section can be collapsed and re-expanded",
        function (Given, When, Then) {
          // Collapse the section by clicking "Show Less"
          When.onTheDetailPage.iPressSeeLess();

          // Re-expand by clicking "Show More"
          When.onTheDetailPage.iPressSeeMore();

          // Verify the data is still visible after re-expanding
          Then.onTheDetailPage.iSeeChangeHistoryEntries(1);
        }
      );

      opaTest(
        "#6: Navigate back to List Report",
        function (Given, When, Then) {
          When.iNavigateBack();
          Then.onTheMainPage.iSeeThisPage();
        }
      );

      return Journey;
    },

    /**
     * Tests that create changelog entries during the test by editing
     * an entity through the draft flow, then verifying the new entries
     * appear in the Change History section.
     */
    testEditAndVerify: function () {
      opaTest(
        "#7: Navigate to a different Incident to edit it",
        function (Given, When, Then) {
          // Use "No current on a sunny day" which has no pre-seeded changes
          When.onTheMainPage
            .onTable()
            .iPressRow({ Title: "No current on a sunny day" });
          Then.onTheDetailPage.iSeeThisPage();
        }
      );

      opaTest(
        "#8: Edit the Incident status via draft flow",
        function (Given, When, Then) {
          // Enter edit mode (creates a draft)
          When.onTheDetailPage.onHeader().iExecuteAction("Edit");
          Then.onTheDetailPage.iSeeObjectPageInEditMode();

          // Change the status from "New" to "In Process" (tracked by @changelog)
          When.onTheDetailPage.iOpenStatusValueHelp();
          When.onTheDetailPage.iSelectStatus("In Process");

          // Wait for draft to be saved, then activate
          Then.onTheDetailPage.onFooter().iCheckDraftStateSaved();
          When.onTheDetailPage.iPressSave();
          Then.onTheDetailPage
            .iSeeThisPage()
            .and.iSeeObjectPageInDisplayMode();
        }
      );

      opaTest(
        "#9: Verify new change entry appears in Change History after edit",
        function (Given, When, Then) {
          // Navigate to Change History section (scroll anchor bar)
          When.onTheDetailPage.iGoToSection("Change History");

          // Section is already expanded (state persists from earlier tests)
          // so we can directly assert table content

          // The status change should have created a changelog entry
          Then.onTheDetailPage.iSeeChangeHistoryEntries(1);

          // Verify the entry shows the new status description
          Then.onTheDetailPage.iSeeChangeHistoryEntryWith({
            newValue: "In Process",
          });
        }
      );

      opaTest(
        "#10: Navigate back to List Report",
        function (Given, When, Then) {
          When.iNavigateBack();
          Then.onTheMainPage.iSeeThisPage();
        }
      );

      return Journey;
    },

    end: function () {
      opaTest("#999: Tear down", function (Given) {
        Given.iTearDownMyApp();
      });

      return Journey;
    },
  };

  Journey.run = function () {
    Journey.start().testPreSeededData().testEditAndVerify().end();
  };

  return Journey;
});
