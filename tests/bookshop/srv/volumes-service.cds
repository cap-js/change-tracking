using {sap.capire.bookshop as my} from '../db/schema';

service VolumnsService {
  entity Volumns                      as projection on my.Volumns excluding {book};
}