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

    // ================================================================
    // Module A: Empty Change History + Update
    // Opens "Solar panel broken" which has NO pre-seeded changelog
    // data. Verifies the section is present but empty, tests the
    // expand/collapse toggle, then updates the status and verifies
    // the update changelog entry.
    // ================================================================
    testEmptyAndUpdate: function () {
      opaTest(
        "#A1: List Report page loads correctly",
        function (Given, When, Then) {
          Then.onTheMainPage.iSeeThisPage();
        }
      );

      opaTest(
        "#A2: Navigate to 'Solar panel broken'",
        function (Given, When, Then) {
          When.onTheMainPage
            .onTable()
            .iPressRow({ Title: "Solar panel broken" });
          Then.onTheDetailPage.iSeeThisPage();
        }
      );

      opaTest(
        "#A3: Change History section exists on the Object Page",
        function (Given, When, Then) {
          Then.onTheDetailPage.iSeeChangeHistorySection();
        }
      );

      opaTest(
        "#A4: Change History section is empty and has correct columns",
        function (Given, When, Then) {
          When.onTheDetailPage.iGoToSection("Change History");
          When.onTheDetailPage.iPressSeeMore();

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

          Then.onTheDetailPage.iSeeEmptyChangeHistory();
        }
      );

      opaTest(
        "#A5: Change History can be collapsed and re-expanded",
        function (Given, When, Then) {
          When.onTheDetailPage.iPressSeeLess();
          When.onTheDetailPage.iPressSeeMore();
          Then.onTheDetailPage.iSeeEmptyChangeHistory();
        }
      );

      opaTest(
        "#A6: Update status to 'Resolved'",
        function (Given, When, Then) {
          When.onTheDetailPage.onHeader().iExecuteAction("Edit");
          Then.onTheDetailPage.iSeeObjectPageInEditMode();

          When.onTheDetailPage.iOpenStatusValueHelp();
          When.onTheDetailPage.iSelectStatus("Resolved");

          Then.onTheDetailPage.onFooter().iCheckDraftStateSaved();
          When.onTheDetailPage.iPressSave();
          Then.onTheDetailPage
            .iSeeThisPage()
            .and.iSeeObjectPageInDisplayMode();
        }
      );

      opaTest(
        "#A7: Change History shows update entry with 'Resolved'",
        function (Given, When, Then) {
          // Section is already expanded (state persists through edit/save)
          When.onTheDetailPage.iGoToSection("Change History");

          Then.onTheDetailPage.iSeeChangeHistoryEntries(1);
          Then.onTheDetailPage.iSeeChangeHistoryRow({
            changeType: "Update",
            newValue: "Resolved",
            objectID: "Sunny Sunshine",
            objectType: "Support Incidents",
          });
        }
      );

      opaTest(
        "#A8: Navigate back to List Report",
        function (Given, When, Then) {
          When.iNavigateBack();
          Then.onTheMainPage.iSeeThisPage();
        }
      );

      return Journey;
    },

    // ================================================================
    // Module B: Pre-seeded Change History
    // Opens "No current on a sunny day" which has pre-seeded changelog
    // data from the CSV. Verifies the entries are displayed correctly.
    // ================================================================
    testPreSeededData: function () {
      opaTest(
        "#B1: Navigate to 'No current on a sunny day'",
        function (Given, When, Then) {
          When.onTheMainPage
            .onTable()
            .iPressRow({ Title: "No current on a sunny day" });
          Then.onTheDetailPage.iSeeThisPage();
        }
      );

      opaTest(
        "#B2: Change History shows pre-seeded entries",
        function (Given, When, Then) {
          // Section expand state persists from Module A
          When.onTheDetailPage.iGoToSection("Change History");

          Then.onTheDetailPage.iSeeChangeHistoryEntries(1);
          Then.onTheDetailPage.iSeeChangeHistoryRow({
            objectID: "Stormy Weathers",
            objectType: "Support Incidents",
          });
        }
      );

      opaTest(
        "#B3: Navigate back to List Report",
        function (Given, When, Then) {
          When.iNavigateBack();
          Then.onTheMainPage.iSeeThisPage();
        }
      );

      return Journey;
    },

    // ================================================================
    // Module C+D: Full create / update / delete lifecycle
    // Creates a new Incident with title, customer, status, and two
    // conversation entries. Verifies create changelog. Then updates
    // one conversation and deletes the other. Verifies update and
    // delete changelog entries.
    // ================================================================
    testCreateUpdateDelete: function () {
      // ── C: Create new Incident with conversations ──────────────

      opaTest(
        "#C1: Create a new Incident from the List Report",
        function (Given, When, Then) {
          When.onTheMainPage.onTable().iExecuteCreate();
          Then.onTheDetailPage.iSeeObjectPageInEditMode();
        }
      );

      opaTest(
        "#C2: Fill incident fields (title, customer, status)",
        function (Given, When, Then) {
          // Set title
          When.onTheDetailPage.iEnterTitle("OPA Test Incident");

          // Set customer via value help dialog
          When.onTheDetailPage.iOpenCustomerValueHelp();
          When.onTheDetailPage.iSelectCustomer("Sunny Sunshine");

          // Set status to "In Process"
          When.onTheDetailPage.iOpenStatusValueHelp();
          When.onTheDetailPage.iSelectStatus("In Process");
        }
      );

      opaTest(
        "#C3: Add two conversation entries",
        function (Given, When, Then) {
          // Scroll to the Conversation section to make the table visible
          When.onTheDetailPage.iGoToSection("Conversation");

          // Add first conversation
          When.onTheDetailPage.iPressConversationCreate();
          When.onTheDetailPage.iEnterConversationMessage(
            "Initial investigation started"
          );

          // Add second conversation
          When.onTheDetailPage.iPressConversationCreate();
          When.onTheDetailPage.iEnterConversationMessage(
            "Customer contacted"
          );
        }
      );

      opaTest(
        "#C4: Save the new Incident",
        function (Given, When, Then) {
          Then.onTheDetailPage.onFooter().iCheckDraftStateSaved();
          When.onTheDetailPage.iPressSave();
          Then.onTheDetailPage
            .iSeeThisPage()
            .and.iSeeObjectPageInDisplayMode();
        }
      );

      opaTest(
        "#C5: Change History shows create entries with correct values",
        function (Given, When, Then) {
          When.onTheDetailPage.iGoToSection("Change History");

          // Section is already expanded (state persists from Module A)

          // Verify the status create entry at row level
          Then.onTheDetailPage.iSeeChangeHistoryRow({
            field: "Status",
            changeType: "Create",
            newValue: "In Process",
            objectID: "Sunny Sunshine",
            objectType: "Support Incidents",
          });

          // Verify the conversation parent row exists
          Then.onTheDetailPage.iSeeChangeHistoryRow({
            field: "conversation",
            changeType: "Create",
            objectID: "Sunny Sunshine",
            objectType: "Support Incidents",
          });

          // Expand the conversation tree row to reveal child entries
          When.onTheDetailPage.iExpandChangeHistoryRow(
            "conversation",
            "Create"
          );

          // Verify the two message child rows
          Then.onTheDetailPage.iSeeChangeHistoryRow({
            field: "message",
            changeType: "Create",
            newValue: "Initial investigation started",
          });
          Then.onTheDetailPage.iSeeChangeHistoryRow({
            field: "message",
            changeType: "Create",
            newValue: "Customer contacted",
          });
        }
      );

      // ── D: Update one conversation, delete the other ───────────

      opaTest(
        "#D1: Edit the Incident",
        function (Given, When, Then) {
          When.onTheDetailPage.onHeader().iExecuteAction("Edit");
          Then.onTheDetailPage.iSeeObjectPageInEditMode();
        }
      );

      opaTest(
        "#D2: Update first conversation and delete second",
        function (Given, When, Then) {
          // Navigate to the Conversation section
          When.onTheDetailPage.iGoToSection("Conversation");

          // Update the first conversation message
          When.onTheDetailPage.iUpdateConversationMessage(
            "Initial investigation started",
            "Investigation completed"
          );

          // Select and delete the second conversation
          When.onTheDetailPage.iSelectConversationRow("Customer contacted");
          When.onTheDetailPage.iPressConversationDelete();
          When.onTheDetailPage.iConfirmDelete();
        }
      );

      opaTest(
        "#D3: Save after update and delete",
        function (Given, When, Then) {
          Then.onTheDetailPage.onFooter().iCheckDraftStateSaved();
          When.onTheDetailPage.iPressSave();
          Then.onTheDetailPage
            .iSeeThisPage()
            .and.iSeeObjectPageInDisplayMode();
        }
      );

      opaTest(
        "#D4: Change History shows update and delete entries",
        function (Given, When, Then) {
          // Section is already expanded (state persists)
          When.onTheDetailPage.iGoToSection("Change History");

          // Verify the conversation parent row for update
          // (contains both update + delete children)
          Then.onTheDetailPage.iSeeChangeHistoryRow({
            field: "conversation",
            changeType: "Update",
            objectID: "Sunny Sunshine",
            objectType: "Support Incidents",
          });

          // Expand the conversation update tree row
          When.onTheDetailPage.iExpandChangeHistoryRow(
            "conversation",
            "Update"
          );

          // Verify the message update child row
          Then.onTheDetailPage.iSeeChangeHistoryRow({
            field: "message",
            changeType: "Update",
            newValue: "Investigation completed",
            oldValue: "Initial investigation started",
          });

          // Verify the message delete child row
          Then.onTheDetailPage.iSeeChangeHistoryRow({
            field: "message",
            changeType: "Delete",
            oldValue: "Customer contacted",
          });
        }
      );

      opaTest(
        "#D5: Navigate back to List Report",
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
    Journey.start()
      .testEmptyAndUpdate()
      .testPreSeededData()
      .testCreateUpdateDelete()
      .end();
  };

  return Journey;
});
