using {sap.capire.common.codelists as codeLists} from '../common/codeLists';

namespace sap.capire.common.types;

type PersonName {
    firstName : String;
    lastName  : String;
}

type CountryName {
    name : String;
    code : String;
}

type LifecycleStatusCode : Association to one codeLists.LifecycleStatusCodes;
type BookTypeCodes : Association to one codeLists.BookTypeCodes;
