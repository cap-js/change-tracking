using {sap.capire.bookshop as my} from '../db/schema';

service VolumnsService {
  entity Volumes                      as projection on my.Volumes excluding {book};
}