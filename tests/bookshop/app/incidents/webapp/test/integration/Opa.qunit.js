sap.ui.require(
	[
		'sap/fe/test/JourneyRunner',
		'ns/incidents/test/integration/pages/IncidentListReport',
		'ns/incidents/test/integration/pages/IncidentObjectPage',
		'ns/incidents/test/integration/EmptyChangeHistoryJourney',
		'ns/incidents/test/integration/PreSeededChangeHistoryJourney',
		'ns/incidents/test/integration/ChangeLifecycleJourney'
	],
	function (JourneyRunner, IncidentListReport, IncidentObjectPage, EmptyChangeHistoryJourney, PreSeededChangeHistoryJourney, ChangeLifecycleJourney) {
		'use strict';

		const runner = new JourneyRunner({
			launchUrl: sap.ui.require.toUrl('ns/incidents') + '/index.html',
			launchParameters: {
				'sap-language': 'EN'
			},
			opaConfig: {
				timeout: 30
			}
		});

		runner.run(
			{
				pages: {
					onTheMainPage: IncidentListReport,
					onTheDetailPage: IncidentObjectPage
				}
			},
			EmptyChangeHistoryJourney.run,
			PreSeededChangeHistoryJourney.run,
			ChangeLifecycleJourney.run
		);
	}
);
