sap.ui.define(
  ["sap/fe/test/ObjectPage", "sap/ui/test/OpaBuilder", "sap/ui/test/actions/Press"],
  function (ObjectPage, OpaBuilder, Press) {
    "use strict";

    /**
     * Helper: checks whether an sap.ui.mdc.Table is the Change History table
     * by looking for the "Changed by" column header.
     *
     * @param {sap.ui.mdc.Table} oTable - The table control to check
     * @returns {boolean} true if this is the Change History table
     */
    function _isChangeHistoryTable(oTable) {
      var aColumns = oTable.getColumns();
      if (!aColumns || aColumns.length === 0) {
        return false;
      }
      var aHeaders = aColumns.map(function (oCol) {
        return oCol.getHeader();
      });
      return aHeaders.indexOf("Changed by") > -1;
    }

    /**
     * Custom actions and assertions for the Incident Object Page,
     * specifically for verifying the Change History section injected
     * by the @cap-js/change-tracking plugin.
     *
     * The Change History section uses @UI.PartOfPreview: false, which
     * means it is collapsed by default. Its content (table, data) is
     * lazy-loaded only when the user navigates to the section. All
     * assertions here use the has() matcher for polling, so OPA keeps
     * retrying until the condition is met or the timeout is reached.
     */
    var AdditionalCustomObjectPageDefinition = {
      actions: {
        /**
         * Clicks the "Show More" link to expand the Change History
         * subsection. Required because @UI.PartOfPreview: false
         * causes the content to be collapsed behind this link.
         */
        iPressSeeMore: function () {
          return this.waitFor({
            id: "ns.incidents::IncidentsObjectPage--fe::FacetSubSection::ChangeHistoryFacet--seeMore",
            actions: new Press({ idSuffix: "BDI-content" }),
            errorMessage:
              "Could not find 'Show More' link for Change History section",
          });
        },

        /**
         * Clicks the "Show Less" link to collapse the Change History
         * subsection back to its default hidden state.
         */
        iPressSeeLess: function () {
          return this.waitFor({
            id: "ns.incidents::IncidentsObjectPage--fe::FacetSubSection::ChangeHistoryFacet--seeLess",
            actions: new Press({ idSuffix: "BDI-content" }),
            errorMessage:
              "Could not find 'Show Less' link for Change History section",
          });
        },

        /**
         * Opens the value help dropdown for the status field.
         * The status is an Association to Status rendered as a
         * combo box with a value help icon.
         */
        iOpenStatusValueHelp: function () {
          return this.waitFor({
            id: "ns.incidents::IncidentsObjectPage--fe::FormContainer::i18nDetails::FormElement::DataField::status_code::Field-edit-inner-vhi",
            actions: new Press(),
            errorMessage: "Could not open status value help",
          });
        },

        /**
         * Selects a status from the open value help dropdown by its
         * description text (e.g. "New", "In Process", "Resolved").
         * Clicks the parent FieldWrapper control (not the inner Text)
         * to properly trigger the selection and close the dropdown.
         *
         * @param {string} sStatusText - The status description to select
         */
        iSelectStatus: function (sStatusText) {
          return this.waitFor({
            controlType: "sap.fe.macros.controls.FieldWrapper",
            searchOpenDialogs: true,
            matchers: function (oWrapper) {
              var oDomRef = oWrapper.getDomRef();
              return oDomRef && oDomRef.innerText.indexOf(sStatusText) > -1;
            },
            actions: new Press(),
            errorMessage:
              "Could not select status '" + sStatusText + "' in value help",
          });
        },

        /**
         * Presses the Save button in the Object Page footer.
         * Uses the exact control ID from the Test Recorder to ensure
         * reliable draft activation.
         */
        iPressSave: function () {
          return this.waitFor({
            id: "ns.incidents::IncidentsObjectPage--fe::FooterBar::StandardAction::Save",
            actions: new Press({ idSuffix: "content" }),
            errorMessage: "Could not find or press the Save button",
          });
        },
      },

      assertions: {
        /**
         * Asserts that the "Change History" section (facet) exists on
         * the Object Page. The section header/anchor is rendered even
         * when collapsed (@UI.PartOfPreview: false), so this works
         * without navigating to the section first.
         */
        iSeeChangeHistorySection: function () {
          return OpaBuilder.create(this)
            .hasType("sap.uxap.ObjectPageSection")
            .has(function (oSection) {
              return oSection.getTitle() === "Change History";
            })
            .description(
              "Seeing the 'Change History' section on the Object Page"
            )
            .execute();
        },

        /**
         * Asserts that the Change History table contains the expected
         * column headers. The condition is inside has() so OPA polls
         * until the mdc.Table is fully initialized after lazy-load.
         *
         * @param {string[]} aExpectedColumns - Array of expected column header texts
         */
        iSeeChangeHistoryColumns: function (aExpectedColumns) {
          return OpaBuilder.create(this)
            .hasType("sap.ui.mdc.Table")
            .has(function (oTable) {
              if (!_isChangeHistoryTable(oTable)) {
                return false;
              }
              // Check that all expected columns are present
              var aHeaders = oTable
                .getColumns()
                .map(function (oCol) {
                  return oCol.getHeader();
                })
                .filter(function (sHeader) {
                  return sHeader && sHeader.length > 0;
                });
              return aExpectedColumns.every(function (sExpected) {
                return aHeaders.indexOf(sExpected) > -1;
              });
            })
            .check(function (aTables) {
              var aHeaders = aTables[0]
                .getColumns()
                .map(function (oCol) {
                  return oCol.getHeader();
                })
                .filter(function (sHeader) {
                  return sHeader && sHeader.length > 0;
                });
              QUnit.assert.ok(
                true,
                "Change History table has expected columns: [" +
                  aHeaders.join(", ") +
                  "]"
              );
              return true;
            })
            .description(
              "Change History table has columns: " +
                aExpectedColumns.join(", ")
            )
            .execute();
        },

        /**
         * Asserts that the Change History table has at least the given
         * number of rows. The row count condition is inside has() so
         * OPA polls until the OData response has arrived and the
         * binding has been populated.
         *
         * @param {number} iMinCount - Minimum expected number of rows
         */
        iSeeChangeHistoryEntries: function (iMinCount) {
          return OpaBuilder.create(this)
            .hasType("sap.ui.mdc.Table")
            .has(function (oTable) {
              if (!_isChangeHistoryTable(oTable)) {
                return false;
              }
              var oRowBinding = oTable.getRowBinding();
              return oRowBinding && oRowBinding.getLength() >= iMinCount;
            })
            .check(function (aTables) {
              var iLength = aTables[0].getRowBinding().getLength();
              QUnit.assert.ok(
                true,
                "Change History table has at least " +
                  iMinCount +
                  " entries (found " +
                  iLength +
                  ")"
              );
              return true;
            })
            .description(
              "Change History table has at least " + iMinCount + " entries"
            )
            .execute();
        },

        /**
         * Asserts that a Change History entry exists containing the
         * specified text values. The DOM text check is inside has()
         * so OPA polls until the table rows are rendered with data.
         *
         * @param {object} oExpected - Key-value pairs to match against
         *   visible table text. Values are the expected cell content.
         */
        iSeeChangeHistoryEntryWith: function (oExpected) {
          var aExpectedValues = Object.keys(oExpected).map(function (sKey) {
            return oExpected[sKey];
          });

          return OpaBuilder.create(this)
            .hasType("sap.ui.mdc.Table")
            .has(function (oTable) {
              if (!_isChangeHistoryTable(oTable)) {
                return false;
              }
              // Check that table DOM contains the expected text values.
              // This polls until the rows are rendered with actual data.
              var oDomRef = oTable.getDomRef();
              if (!oDomRef) {
                return false;
              }
              var sTableText = oDomRef.innerText;
              return aExpectedValues.every(function (sValue) {
                return sTableText.indexOf(sValue) > -1;
              });
            })
            .check(function () {
              QUnit.assert.ok(
                true,
                "Change History table contains entry with: " +
                  JSON.stringify(oExpected)
              );
              return true;
            })
            .description(
              "Change History table contains entry with: " +
                JSON.stringify(oExpected)
            )
            .execute();
        },
      },
    };

    return new ObjectPage(
      {
        appId: "ns.incidents",
        componentId: "IncidentsObjectPage",
        entitySet: "Incidents",
      },
      AdditionalCustomObjectPageDefinition
    );
  }
);
