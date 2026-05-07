using { cuid, managed, sap.common.CodeList, Country } from '@sap/cds/common';

namespace sap.capire.incidents;

/**
 * Customers using products sold by our company.
 * Customers can create support Incidents.
 */
@changelog : [name]
entity Customers : managed {
  key ID         : String;
  firstName      : String @changelog;
  lastName       : String @changelog;
  name           : String = firstName ||' '|| lastName;
  email          : EMailAddress @changelog;
  phone          : PhoneNumber  @changelog;
  creditCardNo   : String(16) @assert.format: '^[1-9]\d{15}$';
  address      : Composition of one Addresses on address.customer = $self;
  incidents      : Association to many Incidents on incidents.customer = $self;
}

entity Addresses : cuid, managed {
  customer       : Association to Customers;
  city           : String;
  postCode       : String;
  streetAddress  : String;
}


/**
 * Incidents created by Customers.
 */
@changelog : (customer.name || ': ' || customer.address.city || ' - ' || title)
@title : 'Support Incidents'
entity Incidents : cuid, managed {
  customer       : Association to Customers @changelog : [customer.name];
  title          : String @title: 'Title';
  urgency        : Association to Urgency default 'M';
  status         : Association to Status default 'N' @changelog : [status.descr] @title : 'Status';
  statusExpr         : Association to Status default 'N' @changelog : (status.descr) @UI.Hidden;
  date           : Date @title : 'date' @changelog;
  datetime       : DateTime @title : 'datetime' @changelog;
  datetimeWTimeZone : DateTime @title : 'datetime with TimeZone' @changelog @Common : { Timezone : 'Asia/Riyadh' };
  datetimeWDynamicTimeZone : DateTime @title : 'datetime with dynamic TimeZone' @changelog @Common : { Timezone : timezone };
  timezone : String default 'Asia/Riyadh' @Common.IsTimezone;
  time           : Time @title : 'time' @changelog;
  timestamp      : Timestamp @title : 'timestamp' @changelog;
  decimalProp : Decimal(15,4) @title : 'Decimal prop' @changelog: (decimalProp * 2);
  conversation   : Composition of many {
    key ID    : UUID;
    timestamp : type of managed:createdAt;
    author    : type of managed:createdBy;
    message   : String @changelog;
  };
  tasks : Composition of many IncidentTasks on tasks.incident = $self;
}

annotate Incidents.conversation with @changelog: (author);

@changelog : [title, timestamp]
entity IncidentTasks : cuid, managed {
  incident    : Association to Incidents;
  title       : String @title: 'Task Title' @changelog;
  description : String @changelog;
}

entity Status : CodeList {
  key code    : String enum {
    new        = 'N';
    assigned   = 'A';
    in_process = 'I';
    on_hold    = 'H';
    resolved   = 'R';
    closed     = 'C';
  };
  criticality : Integer;
}

entity Urgency : CodeList {
  key code : String enum {
    high   = 'H';
    medium = 'M';
    low    = 'L';
  };
}

type EMailAddress : String;
type PhoneNumber  : String;


entity MultiKeyScenario {
  key GJAHR: Integer;
  key BUKRS: String(40);
      foo1: String @changelog;
      datetime : DateTime @changelog @Common.Timezone : timezone;
      timezone: String default 'Europe/Amsterdam' @Common.IsTimezone;
}

@Capabilities : { NavigationRestrictions : {
    RestrictedProperties : [
        {
            NavigationProperty : changes,
            ReadRestrictions : {
                Readable : true,
            },
        },
    ],
}, }
entity BooksNotID {
  key NOT_ID : String;
      @changelog
      title  : String;
      @changelog
      pages : Composition of many PagesNotID on pages.book = $self;
}

entity PagesNotID {
  key NOT_ID : String;
      book : Association to one BooksNotID;
      @changelog : [book.title, page]
      page  : Integer;
}



entity Orders : cuid {
  abc : String @changelog;
  @changelog
  orderProducts : Composition of many OrderProducts on orderProducts.order = $self;
}

entity OrderProducts : cuid {
  order : Association to one Orders;
  country : Country @changelog : [country.name];
  price: Decimal @changelog;
}

entity DynamicLocalizationScenarios : cuid {
  status1 : Association to one Status default 'N' @changelog : [status1.descr, status1.code]; // Multiple fields -> not possible
  status2 : Association to one Status default 'N' @changelog : [status1.descr]; //Not own path -> not possible
  status3 : Association to one VHWithMultiKey @changelog : [status3.name]; //Target has multiple keys -> not possible

  status4 : String @changelog : [status4Nav.descr]; //Unmanaged association -> possible;
  status4Nav: Association to one Status on status4Nav.code = status4 @changelog : [status4Nav.descr];
}

entity VHWithMultiKey : CodeList {
  key code    : String;
  key code2 : String;
  name: localized String;
}


/**
 * Test entity for expression-based @changelog annotations.
 * Uses CDS expressions (parenthesized) instead of simple paths.
 */
@changelog : (firstName || ' ' || lastName)
entity ExpressionScenarios : cuid {
  firstName : String @changelog;
  lastName  : String @changelog;
  price       : Decimal @changelog: (price < 100 ? 'Budget' : 'Premium');
  decimalProp : Decimal(15,4) @changelog: (decimalProp * 2);
  status      : Association to Status default 'N' @changelog : (status.code || ': ' || status.descr);
}