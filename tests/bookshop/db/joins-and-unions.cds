
namespace sap.change_tracking;

entity Events {
    key ID: UUID;
    object_ID          : String not null         @mandatory;
    object_Type        : String not null         @mandatory  @assert.range  enum {
        A;
        B;
        C;
        D;
        E;
    };
    code               : String not null         @mandatory  @assert.notNull;
    message            : String;
    foo1          : Component not null      @mandatory  @assert.range;
    foo2          : Component default 'ABC' @assert.range;
}

type Component          : String enum {
  ABC;
  DEF;
  HIJ;
  KLM;
}

entity UseCases {
    key ID :UUID;
          type                   : String(100) @changelog;
          booleanField                 : Boolean default false  @changelog;
          name                   : String(100)  @changelog;
          description            : String(500)  @changelog;
          expiredAt              : Date  @changelog;
          area: String @changelog;
};

entity DataRequests {
    key ID :UUID;
    useCase_ID: UUID;
    useCase: Association to one UseCases on useCase.ID = useCase_ID;
};
entity DataSets {
    key ID :UUID;
    dataRequest: Association to one DataRequests;
};
entity DataDefinition {
    key ID :UUID;
    dataRequest: Association to one DataRequests;
};
entity DataAreas {
    key ID :UUID;
    name: String @changelog;
};

view ExtendedEvents as
    select
      key events.ID,
          events.object_ID,
          events.object_Type,
          events.code,
          events.message,
          events.foo1,
          events.foo2,
          object_ID     as usecase_ID,
          null          as dataRequest_ID : String,
          usecases.type as usecase_type
    from Events as events
    inner join UseCases as usecases
      on  events.object_ID   = usecases.ID
      and events.object_Type = 'A'
  union
    select
      key events.ID,
          events.object_ID,
          events.object_Type,
          events.code,
          events.message,
          events.foo1,
          events.foo2,
          datarequests.useCase_ID       as useCase_ID,
          datarequests.ID               as dataRequest_ID,
          datarequests.useCase.type     as usecase_type
    from Events as events
    inner join DataRequests as datarequests
      on  events.object_ID   = datarequests.ID
      and events.object_Type = 'B'
  union
    //events related to the datasets
    select
      key events.ID,
          events.object_ID,
          events.object_Type,
          events.code,
          events.message,
          events.foo1,
          events.foo2,
          datarequests.useCase_ID,
          datarequests.ID               as dataRequest_ID,
          datarequests.useCase.type     as usecase_type
    from Events as events
    inner join DataSets as datasets
      on  events.object_ID   = datasets.ID
      and events.object_Type = 'C'
    inner join DataRequests as datarequests
      on datasets.dataRequest.ID = datarequests.ID
  union
    //events related to the datadefinitions
    select
      key events.ID,
          events.object_ID,
          events.object_Type,
          events.code,
          events.message,
          events.foo1,
          events.foo2,
          datarequests.useCase_ID,
          datarequests.ID               as dataRequest_ID,
          datarequests.useCase.type     as usecase_type
    from Events as events
    inner join DataDefinition as datadefinitions
      on  events.object_ID   = datadefinitions.ID
      and events.object_Type = 'D'
    inner join DataRequests as datarequests
      on datadefinitions.dataRequest.ID = datarequests.ID
  union
    // events related to the data area
    select
      key events.ID,
          events.object_ID,
          events.object_Type,
          events.code,
          events.message,
          events.foo1,
          events.foo2,
          
          usecases.ID       as usecase_ID,
          null              as datarequest_ID : String,
          usecases.type     as usecase_type
    from Events as events
    inner join DataAreas as dataareas
      on  events.object_ID   = dataareas.name
      and events.object_Type = 'E'
    inner join UseCases as usecases
      on dataareas.ID = usecases.area;


view DataExtractionSummaryView as
  select
    key uc.ID                           as useCaseID                 : String,
        uc.name                         as useCaseName               : String,
        count(ds.ID)                    as totalDatasets             : Integer,
        count(case
                when
                  ds.ID = 'A'
                then
                  1
              end)                      as abc    : Integer,
        count(case
                when
                  ds.ID = 'B'
                then
                  1
              end)                      as def : Integer,
        ds.dataRequest.useCase.type     as useCaseType
  from DataSets as ds
  inner join DataRequests as dr
    on ds.dataRequest.ID = dr.ID
  inner join UseCases as uc
    on dr.useCase_ID = uc.ID
  group by
    uc.ID,
    uc.name,
    ds.dataRequest.useCase.type;