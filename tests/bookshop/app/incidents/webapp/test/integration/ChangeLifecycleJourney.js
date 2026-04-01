/* global QUnit */
sap.ui.define(["sap/ui/test/opaQunit"], function (opaTest) {
  "use strict";

  /**
   * Journey C+D: Create / Update / Delete Lifecycle
   *
   * A support agent creates a brand new incident with title, customer,
   * status, and two conversation entries. Verifies create changelog
   * entries including the tree hierarchy for conversations. Then updates
   * one conversation message and deletes the other. Verifies update
   * and delete changelog entries in the tree hierarchy.
   */
  var Journey = {
    run: function () {
      QUnit.module("Create / Update / Delete Lifecycle");

      // ── C: Create new Incident with conversations ──────────────

      opaTest(
        "Create a new Incident from the List Report",
        function (Given, When, Then) {
          When.onTheMainPage.onTable().iExecuteCreate();
          Then.onTheDetailPage.iSeeObjectPageInEditMode();
        }
      );

      opaTest(
        "Fill incident fields (title, customer, status)",
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
        "Add two conversation entries",
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
        "Save the new Incident",
        function (Given, When, Then) {
          Then.onTheDetailPage.onFooter().iCheckDraftStateSaved();
          When.onTheDetailPage.iPressSave();
          Then.onTheDetailPage
            .iSeeThisPage()
            .and.iSeeObjectPageInDisplayMode();
        }
      );

      opaTest(
        "Change History shows create entries with correct values",
        function (Given, When, Then) {
          When.onTheDetailPage.iGoToSection("Change History");

          // Section is already expanded (state persists from previous journey)

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
        "Edit the Incident",
        function (Given, When, Then) {
          When.onTheDetailPage.onHeader().iExecuteAction("Edit");
          Then.onTheDetailPage.iSeeObjectPageInEditMode();
        }
      );

      opaTest(
        "Update first conversation and delete second",
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
        "Save after update and delete",
        function (Given, When, Then) {
          Then.onTheDetailPage.onFooter().iCheckDraftStateSaved();
          When.onTheDetailPage.iPressSave();
          Then.onTheDetailPage
            .iSeeThisPage()
            .and.iSeeObjectPageInDisplayMode();
        }
      );

      opaTest(
        "Change History shows update and delete entries",
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
        "Navigate back to List Report",
        function (Given, When, Then) {
          When.iNavigateBack();
          Then.onTheMainPage.iSeeThisPage();
        }
      );

      // ── Teardown ───────────────────────────────────────────────

      opaTest("Tear down", function (Given) {
        Given.iTearDownMyApp();
      });
    },
  };

  return Journey;
});
