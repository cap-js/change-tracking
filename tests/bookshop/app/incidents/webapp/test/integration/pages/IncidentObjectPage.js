/* global QUnit */
sap.ui.define(['sap/fe/test/ObjectPage', 'sap/ui/test/OpaBuilder', 'sap/ui/test/actions/Press', 'sap/ui/test/actions/EnterText'], function (ObjectPage, OpaBuilder, Press, EnterText) {
	'use strict';

	// Stable IDs from Test Recorder
	var _sPrefix = 'ns.incidents::IncidentsObjectPage--';
	var _sIdSeeMore = _sPrefix + 'fe::FacetSubSection::ChangeHistoryFacet--seeMore';
	var _sIdSeeLess = _sPrefix + 'fe::FacetSubSection::ChangeHistoryFacet--seeLess';
	var _sIdStatusVhi = _sPrefix + 'fe::FormContainer::i18nDetails::FormElement::DataField::status_code::Field-edit-inner-vhi';
	var _sIdCustomerVhi = _sPrefix + 'fe::FormContainer::GeneratedFacet1::FormElement::DataField::customer_ID::Field-edit-inner-vhi';
	var _sIdTitleField = _sPrefix + 'fe::FormContainer::GeneratedFacet1::FormElement::DataField::title::Field-edit';
	var _sIdSaveButton = _sPrefix + 'fe::FooterBar::StandardAction::Save';
	var _sIdConversationDeleteButton = _sPrefix + 'fe::table::conversation::LineItem::i18nConversation1::StandardAction::Delete';
	var _sIdConversationCreateButton = _sPrefix + 'fe::table::conversation::LineItem::i18nConversation1::StandardAction::Create';
	var _sIdConversationTable = _sPrefix + 'fe::table::conversation::LineItem::i18nConversation1-innerTable';

	/**
	 * Helper: checks whether an sap.ui.mdc.Table is the Change History table
	 * by looking for the "Changed by" column header.
	 */
	function _isChangeHistoryTable(oTable) {
		var aColumns = oTable.getColumns();
		if (!aColumns || aColumns.length === 0) {
			return false;
		}
		var aHeaders = aColumns.map(function (oCol) {
			return oCol.getHeader();
		});
		return aHeaders.indexOf('Changed by') > -1;
	}

	function _isChangeHistoryRow(oRow) {
		var oInnerTable = oRow.getParent();
		if (!oInnerTable) {
			return false;
		}
		var oMdcTable = oInnerTable.getParent();
		if (!oMdcTable || !oMdcTable.isA('sap.ui.mdc.Table')) {
			return false;
		}
		return _isChangeHistoryTable(oMdcTable);
	}

	/**
	 * Custom actions and assertions for the Incident Object Page,
	 * specifically for verifying the Change History section injected
	 * by the @cap-js/change-tracking plugin.
	 */
	var AdditionalCustomObjectPageDefinition = {
		actions: {
			// ──────────────────────────────────────────────────────────
			// Change History section expand / collapse
			// ──────────────────────────────────────────────────────────

			/**
			 * Clicks "Show More" to expand the collapsed Change History
			 * subsection (@UI.PartOfPreview: false).
			 */
			iPressSeeMore: function () {
				return this.waitFor({
					id: _sIdSeeMore,
					actions: new Press({ idSuffix: 'BDI-content' }),
					errorMessage: "Could not find 'Show More' link for Change History section"
				});
			},

			/**
			 * Clicks "Show Less" to collapse the Change History subsection.
			 */
			iPressSeeLess: function () {
				return this.waitFor({
					id: _sIdSeeLess,
					actions: new Press({ idSuffix: 'BDI-content' }),
					errorMessage: "Could not find 'Show Less' link for Change History section"
				});
			},

			/**
			 * Expands a Change History tree row by clicking its tree icon.
			 * Finds a sap.ui.table.Row whose DOM text contains the given
			 * field text and optionally a change type text.
			 * @param {string} sFieldText - Text in the "Field" column (e.g. "conversation")
			 * @param {string} [sChangeType] - Optional change type (e.g. "Create", "Update")
			 */
			iExpandChangeHistoryRow: function (sFieldText, sChangeType) {
				return this.waitFor({
					controlType: 'sap.ui.table.Row',
					matchers: function (oRow) {
						if (!_isChangeHistoryRow(oRow)) {
							return false;
						}
						var oDomRef = oRow.getDomRef();
						if (!oDomRef) {
							return false;
						}
						var sText = oDomRef.innerText;
						if (sText.indexOf(sFieldText) === -1) {
							return false;
						}
						if (sChangeType && sText.indexOf(sChangeType) === -1) {
							return false;
						}
						return true;
					},
					actions: new Press({ idSuffix: 'treeicon' }),
					errorMessage: "Could not expand Change History row with '" + sFieldText + "'" + (sChangeType ? " and change type '" + sChangeType + "'" : '')
				});
			},

			// ──────────────────────────────────────────────────────────
			// Incident field editing
			// ──────────────────────────────────────────────────────────

			/**
			 * Types a title into the title field.
			 * @param {string} sTitle - The title text
			 */
			iEnterTitle: function (sTitle) {
				return this.waitFor({
					id: _sIdTitleField,
					actions: new EnterText({
						idSuffix: 'inner',
						text: sTitle,
						clearTextFirst: true
					}),
					errorMessage: 'Could not enter title'
				});
			},

			/**
			 * Opens the customer value help dialog.
			 */
			iOpenCustomerValueHelp: function () {
				return this.waitFor({
					id: _sIdCustomerVhi,
					actions: new Press(),
					errorMessage: 'Could not open customer value help'
				});
			},

			/**
			 * Selects a customer from the open value help dialog by
			 * finding the FieldWrapper whose DOM text contains the
			 * customer name.
			 * @param {string} sCustomerName - e.g. "Sunny Sunshine"
			 */
			iSelectCustomer: function (sCustomerName) {
				return this.waitFor({
					controlType: 'sap.fe.macros.controls.FieldWrapper',
					searchOpenDialogs: true,
					matchers: function (oWrapper) {
						var oDomRef = oWrapper.getDomRef();
						return oDomRef && oDomRef.innerText.indexOf(sCustomerName) > -1;
					},
					actions: new Press(),
					errorMessage: "Could not select customer '" + sCustomerName + "' from value help"
				});
			},

			/**
			 * Opens the status value help dropdown.
			 */
			iOpenStatusValueHelp: function () {
				return this.waitFor({
					id: _sIdStatusVhi,
					actions: new Press(),
					errorMessage: 'Could not open status value help'
				});
			},

			/**
			 * Selects a status from the open value help by clicking the
			 * FieldWrapper whose DOM text contains the given description.
			 * @param {string} sStatusText - e.g. "In Process", "Resolved"
			 */
			iSelectStatus: function (sStatusText) {
				return this.waitFor({
					controlType: 'sap.fe.macros.controls.FieldWrapper',
					searchOpenDialogs: true,
					matchers: function (oWrapper) {
						var oDomRef = oWrapper.getDomRef();
						return oDomRef && oDomRef.innerText.indexOf(sStatusText) > -1;
					},
					actions: new Press(),
					errorMessage: "Could not select status '" + sStatusText + "' in value help"
				});
			},

			/**
			 * Presses the Save button in the Object Page footer.
			 */
			iPressSave: function () {
				return this.waitFor({
					id: _sIdSaveButton,
					actions: new Press({ idSuffix: 'content' }),
					errorMessage: 'Could not press Save button'
				});
			},

			// ──────────────────────────────────────────────────────────
			// Conversation table actions
			// ──────────────────────────────────────────────────────────

			/**
			 * Presses the Create button on the conversation table toolbar
			 * to add a new inline row.
			 */
			iPressConversationCreate: function () {
				return this.waitFor({
					id: _sIdConversationCreateButton,
					actions: new Press({ idSuffix: 'BDI-content' }),
					errorMessage: 'Could not press conversation Create button'
				});
			},

			/**
			 * Types a message into an empty conversation message input.
			 * Finds a sap.m.Input bound to the "message" property that
			 * has no value yet (newly created inline row).
			 * @param {string} sMessage - The message text to enter
			 */
			iEnterConversationMessage: function (sMessage) {
				return this.waitFor({
					controlType: 'sap.m.Input',
					matchers: function (oInput) {
						// Must be bound to the "message" property
						var sBindingPath = oInput.getBindingPath('value');
						if (sBindingPath !== 'message') {
							return false;
						}
						// Must be empty (newly created row)
						return !oInput.getValue() || oInput.getValue() === '';
					},
					actions: new EnterText({
						idSuffix: 'inner',
						text: sMessage
					}),
					errorMessage: 'Could not find empty conversation message input'
				});
			},

			/**
			 * Updates an existing conversation message by finding the
			 * input bound to "message" that currently has the old text.
			 * @param {string} sOldMessage - Current message text
			 * @param {string} sNewMessage - New message text
			 */
			iUpdateConversationMessage: function (sOldMessage, sNewMessage) {
				return this.waitFor({
					controlType: 'sap.m.Input',
					matchers: function (oInput) {
						var sBindingPath = oInput.getBindingPath('value');
						if (sBindingPath !== 'message') {
							return false;
						}
						return oInput.getValue() === sOldMessage;
					},
					actions: new EnterText({
						idSuffix: 'inner',
						text: sNewMessage,
						clearTextFirst: true
					}),
					errorMessage: "Could not find conversation message '" + sOldMessage + "'"
				});
			},

			/**
			 * Selects a conversation row by finding the editable CheckBox
			 * inside a ColumnListItem in the conversation table whose
			 * cells contain the specified message text. Uses getValue()
			 * for sap.m.Input (edit mode) and getText() for sap.m.Text
			 * (display mode) to match reliably in both states.
			 * @param {string} sMessage - The message text identifying the row
			 */
			iSelectConversationRow: function (sMessage) {
				return this.waitFor({
					controlType: 'sap.m.CheckBox',
					matchers: function (oCheckBox) {
						if (!oCheckBox.getEditable()) {
							return false;
						}
						// Parent must be a ColumnListItem
						var oItem = oCheckBox.getParent();
						if (!oItem || !oItem.isA('sap.m.ColumnListItem')) {
							return false;
						}
						// ColumnListItem must be inside the conversation table
						var oTable = oItem.getParent();
						if (!oTable || !oTable.getId || oTable.getId() !== _sIdConversationTable) {
							return false;
						}
						// Check cells for the message text
						var aCells = oItem.getCells();
						return aCells.some(function (oCell) {
							if (oCell.getValue) {
								return oCell.getValue() === sMessage;
							}
							if (oCell.getText) {
								return oCell.getText() === sMessage;
							}
							return false;
						});
					},
					actions: new Press({ idSuffix: 'CbBg' }),
					errorMessage: "Could not select conversation row with message '" + sMessage + "'"
				});
			},

			/**
			 * Presses the Delete button on the conversation table toolbar.
			 */
			iPressConversationDelete: function () {
				return this.waitFor({
					id: _sIdConversationDeleteButton,
					actions: new Press({ idSuffix: 'BDI-content' }),
					errorMessage: 'Could not press conversation Delete button'
				});
			},

			/**
			 * Confirms a deletion by pressing the "Delete" button in the
			 * confirmation dialog that appears after pressing Delete.
			 */
			iConfirmDelete: function () {
				return this.waitFor({
					controlType: 'sap.m.Button',
					properties: { text: 'Delete' },
					searchOpenDialogs: true,
					actions: new Press({ idSuffix: 'BDI-content' }),
					errorMessage: 'Could not confirm deletion in dialog'
				});
			}
		},

		assertions: {
			// ──────────────────────────────────────────────────────────
			// Change History assertions
			// ──────────────────────────────────────────────────────────

			/**
			 * Asserts that the "Change History" section exists on the
			 * Object Page (works even when collapsed).
			 */
			iSeeChangeHistorySection: function () {
				return OpaBuilder.create(this)
					.hasType('sap.uxap.ObjectPageSection')
					.has(function (oSection) {
						return oSection.getTitle() === 'Change History';
					})
					.description("Seeing the 'Change History' section on the Object Page")
					.execute();
			},

			/**
			 * Asserts that the "Change History" section is NOT visible
			 * on the Object Page. Used to verify the section is hidden
			 * in draft/edit mode (@UI.Hidden: not $draft.IsActiveEntity).
			 * Polls until no visible "Change History" section is found.
			 */
			iDontSeeChangeHistorySection: function () {
				return this.waitFor({
					controlType: 'sap.uxap.ObjectPageSection',
					timeout: 15,
					check: function (aSections) {
						var bChangeHistoryVisible = aSections.some(function (oSection) {
							return oSection.getTitle() === 'Change History' && oSection.getVisible();
						});
						return !bChangeHistoryVisible;
					},
					success: function () {
						QUnit.assert.ok(true, 'Change History section is not visible in edit mode');
					},
					errorMessage: 'Change History section should not be visible in edit mode'
				});
			},

			/**
			 * Asserts that the Change History table has the expected columns.
			 * Polls until the table is fully initialized after lazy-load.
			 * @param {string[]} aExpectedColumns - Expected column header texts
			 */
			iSeeChangeHistoryColumns: function (aExpectedColumns) {
				return OpaBuilder.create(this)
					.hasType('sap.ui.mdc.Table')
					.has(function (oTable) {
						if (!_isChangeHistoryTable(oTable)) {
							return false;
						}
						var aHeaders = oTable
							.getColumns()
							.map(function (oCol) {
								return oCol.getHeader();
							})
							.filter(function (s) {
								return s && s.length > 0;
							});
						return aExpectedColumns.every(function (sExp) {
							return aHeaders.indexOf(sExp) > -1;
						});
					})
					.check(function (aTables) {
						var aHeaders = aTables[0]
							.getColumns()
							.map(function (oCol) {
								return oCol.getHeader();
							})
							.filter(function (s) {
								return s && s.length > 0;
							});
						QUnit.assert.ok(true, 'Change History columns: [' + aHeaders.join(', ') + ']');
						return true;
					})
					.description('Change History table has columns: ' + aExpectedColumns.join(', '))
					.execute();
			},

			/**
			 * Asserts that the Change History table is empty (0 entries).
			 * Polls until the table binding is initialized.
			 */
			iSeeEmptyChangeHistory: function () {
				return OpaBuilder.create(this)
					.hasType('sap.ui.mdc.Table')
					.has(function (oTable) {
						if (!_isChangeHistoryTable(oTable)) {
							return false;
						}
						var oRowBinding = oTable.getRowBinding();
						return oRowBinding && oRowBinding.getLength() === 0;
					})
					.check(function () {
						QUnit.assert.ok(true, 'Change History table is empty');
						return true;
					})
					.description('Change History table is empty')
					.execute();
			},

			/**
			 * Asserts that the Change History table has at least N rows.
			 * Polls until the OData response populates the binding.
			 * @param {number} iMinCount - Minimum expected row count
			 */
			iSeeChangeHistoryEntries: function (iMinCount) {
				return OpaBuilder.create(this)
					.hasType('sap.ui.mdc.Table')
					.has(function (oTable) {
						if (!_isChangeHistoryTable(oTable)) {
							return false;
						}
						var oRowBinding = oTable.getRowBinding();
						return oRowBinding && oRowBinding.getLength() >= iMinCount;
					})
					.check(function (aTables) {
						var iLen = aTables[0].getRowBinding().getLength();
						QUnit.assert.ok(true, 'Change History: at least ' + iMinCount + ' entries (found ' + iLen + ')');
						return true;
					})
					.description('Change History table has >= ' + iMinCount + ' entries')
					.execute();
			},

			/**
			 * Asserts that specific text values appear in the Change
			 * History table DOM. Polls until rendered.
			 * @param {object} oExpected - Key-value pairs of expected text
			 */
			iSeeChangeHistoryEntryWith: function (oExpected) {
				var aExpectedValues = Object.keys(oExpected).map(function (k) {
					return oExpected[k];
				});

				return OpaBuilder.create(this)
					.hasType('sap.ui.mdc.Table')
					.has(function (oTable) {
						if (!_isChangeHistoryTable(oTable)) {
							return false;
						}
						var oDomRef = oTable.getDomRef();
						if (!oDomRef) {
							return false;
						}
						var sText = oDomRef.innerText;
						return aExpectedValues.every(function (sVal) {
							return sText.indexOf(sVal) > -1;
						});
					})
					.check(function () {
						QUnit.assert.ok(true, 'Change History contains: ' + JSON.stringify(oExpected));
						return true;
					})
					.description('Change History contains: ' + JSON.stringify(oExpected))
					.execute();
			},

			/**
			 * Asserts that a specific row exists in the Change History
			 * tree table where ALL expected values appear in the same
			 * row's DOM text. More precise than iSeeChangeHistoryEntryWith
			 * which checks the entire table.
			 * @param {object} oExpected - Key-value pairs that must all
			 *   appear in a single row (e.g. { field: "Status",
			 *   changeType: "Create", newValue: "In Process" })
			 */
			iSeeChangeHistoryRow: function (oExpected) {
				var aExpectedValues = Object.keys(oExpected).map(function (k) {
					return oExpected[k];
				});

				return OpaBuilder.create(this)
					.hasType('sap.ui.table.Row')
					.has(function (oRow) {
						if (!_isChangeHistoryRow(oRow)) {
							return false;
						}
						var oDomRef = oRow.getDomRef();
						if (!oDomRef) {
							return false;
						}
						var sText = oDomRef.innerText;
						return aExpectedValues.every(function (sVal) {
							return sText.indexOf(sVal) > -1;
						});
					})
					.check(function () {
						QUnit.assert.ok(true, 'Found Change History row: ' + JSON.stringify(oExpected));
						return true;
					})
					.description('Change History has row: ' + JSON.stringify(oExpected))
					.execute();
			}
		}
	};

	return new ObjectPage(
		{
			appId: 'ns.incidents',
			componentId: 'IncidentsObjectPage',
			entitySet: 'Incidents'
		},
		AdditionalCustomObjectPageDefinition
	);
});
