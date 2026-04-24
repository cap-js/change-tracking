using {
  cuid,
  managed,
} from '@sap/cds/common';

namespace sap.change_tracking.batch;

entity Projects : cuid, managed {
  name             : String(100)  @mandatory;
  description      : String(500)  @mandatory;
  type             : String(100);
  closed           : Boolean default false;
  owner_ID         : String(100)  @readonly;
  tasks            : Composition of many Tasks
                       on tasks.project = $self;
}

entity Tasks : cuid, managed {
  project_ID       : UUID         @mandatory;
  type_ID          : String       @mandatory;
  approvalStatus_ID : String(100) default 'IN_PROCESS';
  project          : Association to one Projects
                       on project.ID = project_ID;
  workItems        : Composition of many WorkItems
                       on workItems.task.ID = $self.ID;
}

@assert.unique: {WorkItems: [
  assignee_ID,
  category_ID
]}
entity WorkItems : cuid, managed {
  task                        : Association to one Tasks               @changelog: [task.ID];
  assignee_ID                 : UUID                                   @mandatory  @changelog;
  category_ID                 : UUID                                   @changelog;
  logs                        : Composition of many WorkItemLogs
                                  on logs.workItem = $self             @changelog: [logs.ID];
  lastLog                     : Composition of one WorkItemLogs        @changelog: [lastLog.ID];
  lastSuccessfulLog           : Composition of one WorkItemLogs        @changelog: [lastSuccessfulLog.ID];
  prefix                      : String default ''                      @changelog;
  status_ID                   : String(100) default 'NEW'              @changelog;
  retryTotalCount             : Integer default 0;
  retryCurrentPolicyCount     : Integer default 0;
  lastRetryPolicy_ID          : UUID;
  isRetryActive               : Boolean default false;
}

entity WorkItemLogs : cuid, managed {
  workItem_ID         : UUID                                           @mandatory  @changelog;
  executionTime       : Timestamp                                      @changelog;
  folderName          : String                                         @changelog;
  workItem            : Association to WorkItems
                          on workItem.ID = workItem_ID;
  status_ID           : String(100)                                    @changelog;
  logReference        : String                                         @changelog;
}
