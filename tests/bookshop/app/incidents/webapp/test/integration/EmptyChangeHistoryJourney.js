/* global QUnit */
sap.ui.define(['sap/ui/test/opaQunit'], function (opaTest) {
	'use strict';

	/**
	 * Journey A: Empty Change History + Update
	 *
	 * A support agent opens an incident ("Solar panel broken") that has
	 * no change history yet. Verifies the Change History section exists
	 * but is empty, tests expand/collapse toggling, confirms the section
	 * is hidden in draft mode, updates the status, and verifies the
	 * update changelog entry appears.
	 */
	var Journey = {
		run: function () {
			QUnit.module('Empty Change History + Update');

			opaTest('Start the app', function (Given) {
				Given.iStartMyApp();
			});

			opaTest('List Report page loads correctly', function (Given, When, Then) {
				Then.onTheMainPage.iSeeThisPage();
			});

			opaTest("Navigate to 'Solar panel broken'", function (Given, When, Then) {
				When.onTheMainPage.onTable().iPressRow({ Title: 'Solar panel broken' });
				Then.onTheDetailPage.iSeeThisPage();
			});

			opaTest('Change History section exists on the Object Page', function (Given, When, Then) {
				Then.onTheDetailPage.iSeeChangeHistorySection();
			});

			opaTest('Change History section is empty and has correct columns', function (Given, When, Then) {
				When.onTheDetailPage.iGoToSection('Change History');
				When.onTheDetailPage.iPressSeeMore();

				Then.onTheDetailPage.iSeeChangeHistoryColumns(['Change Type', 'Object Type', 'Object ID', 'Field', 'New Value', 'Old Value', 'Changed at', 'Changed by']);

				Then.onTheDetailPage.iSeeEmptyChangeHistory();
			});

			opaTest('Change History can be collapsed and re-expanded', function (Given, When, Then) {
				When.onTheDetailPage.iPressSeeLess();
				When.onTheDetailPage.iPressSeeMore();
				Then.onTheDetailPage.iSeeEmptyChangeHistory();
			});

			opaTest("Change History is hidden in draft mode; update status to 'Resolved'", function (Given, When, Then) {
				When.onTheDetailPage.onHeader().iExecuteAction('Edit');
				Then.onTheDetailPage.iSeeObjectPageInEditMode();

				// Verify Change History is NOT visible in draft/edit mode
				Then.onTheDetailPage.iDontSeeChangeHistorySection();

				When.onTheDetailPage.iOpenStatusValueHelp();
				When.onTheDetailPage.iSelectStatus('Resolved');

				Then.onTheDetailPage.onFooter().iCheckDraftStateSaved();
				When.onTheDetailPage.iPressSave();
				Then.onTheDetailPage.iSeeThisPage().and.iSeeObjectPageInDisplayMode();
			});

			opaTest("Change History shows update entry with 'Resolved'", function (Given, When, Then) {
				// Section is already expanded (state persists through edit/save)
				When.onTheDetailPage.iGoToSection('Change History');

				Then.onTheDetailPage.iSeeChangeHistoryEntries(1);
				Then.onTheDetailPage.iSeeChangeHistoryRow({
					changeType: 'Update',
					newValue: 'Resolved',
					objectID: 'Sunny Sunshine',
					objectType: 'Support Incidents'
				});
			});

			opaTest('Navigate back to List Report', function (Given, When, Then) {
				When.iNavigateBack();
				Then.onTheMainPage.iSeeThisPage();
			});
		}
	};

	return Journey;
});
