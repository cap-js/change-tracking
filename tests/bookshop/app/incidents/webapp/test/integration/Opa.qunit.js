sap.ui.require(
  [
    "sap/fe/test/JourneyRunner",
    "ns/incidents/test/integration/pages/IncidentListReport",
    "ns/incidents/test/integration/pages/IncidentObjectPage",
    "ns/incidents/test/integration/ChangeTrackingJourney",
  ],
  function (JourneyRunner, IncidentListReport, IncidentObjectPage, Journey) {
    "use strict";

    const runner = new JourneyRunner({
      launchUrl:
        sap.ui.require.toUrl("ns/incidents") + "/index.html",
      launchParameters: {
        "sap-language": "EN",
      },
      opaConfig: {
        timeout: 60,
      },
    });

    runner.run(
      {
        pages: {
          onTheMainPage: IncidentListReport,
          onTheDetailPage: IncidentObjectPage,
        },
      },
      Journey.run
    );
  }
);
