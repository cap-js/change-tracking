using {
  cuid,
  managed,
} from '@sap/cds/common';

namespace sap.dh;

entity UseCases : cuid, managed {
  name             : String(100)  @mandatory;
  description      : String(500)  @mandatory;
  type             : String(100);
  closed           : Boolean default false;
  owner_ID         : String(100)  @readonly;
  dataRequests     : Composition of many DataRequests
                       on dataRequests.useCase = $self;
}

entity DataRequests : cuid, managed {
  useCase_ID       : UUID         @mandatory;
  type_ID          : String       @mandatory;
  govStatus_ID     : String(100) default 'IN_PROCESS';
  useCase          : Association to one UseCases
                       on useCase.ID = useCase_ID;
  dataSets         : Composition of many DataSets
                       on dataSets.dataRequest.ID = $self.ID;
}

@assert.unique: {DataSets: [
  tenant_ID,
  definitions_ID
]}
entity DataSets : cuid, managed {
  dataRequest                 : Association to one DataRequests       @changelog: [dataRequest.ID];
  tenant_ID                   : UUID                                 @mandatory  @changelog;
  definitions_ID              : UUID                                 @changelog;
  extractions                 : Composition of many DataSetExtractions
                                  on extractions.dataSet = $self     @changelog: [extractions.ID];
  lastExtraction              : Composition of one DataSetExtractions @changelog: [lastExtraction.ID];
  lastSuccessfulExtraction    : Composition of one DataSetExtractions @changelog: [lastSuccessfulExtraction.ID];
  prefix                      : String default ''                    @changelog;
  status_ID                   : String(100) default 'NEW'            @changelog;
  autoRetryTotalCount         : Integer default 0;
  autoRetryCurrentPolicyCount : Integer default 0;
  lastAutoRetryPolicy_ID      : UUID;
  isAutoRetryActive           : Boolean default false;
}

entity DataSetExtractions : cuid, managed {
  dataSet_ID          : UUID                                         @mandatory  @changelog;
  extractionTime      : Timestamp                                    @changelog;
  folderName          : String                                       @changelog;
  dataSet             : Association to DataSets
                          on dataSet.ID = dataSet_ID;
  status_ID           : String(100)                                  @changelog;
  extractionReference : String                                       @changelog;
}
