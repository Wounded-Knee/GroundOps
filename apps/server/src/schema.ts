import { addressBookCompanyShare, addressBookEntry, addressBookPhoneStar } from "./schema/addressBook.js";
import { driver, driverAvailabilityEvent, driverCompany } from "./schema/driver.js";
import { session, user, userCredential } from "./schema/identity.js";
import { company, facility } from "./schema/platform.js";
import {
  driverMeterReading,
  driverTariff,
  locationObservation,
  operationalEvent,
  sortie,
  sortieStop,
} from "./schema/sortie.js";

export { addressBookCompanyShare, addressBookEntry, addressBookPhoneStar } from "./schema/addressBook.js";
export { driver, driverAvailabilityEvent, driverCompany } from "./schema/driver.js";
export { session, user, userCredential } from "./schema/identity.js";
export { company, facility } from "./schema/platform.js";
export {
  driverMeterReading,
  driverTariff,
  locationObservation,
  operationalEvent,
  sortie,
  sortieStop,
} from "./schema/sortie.js";

export const schema = {
  user,
  userCredential,
  session,
  driver,
  driverAvailabilityEvent,
  company,
  facility,
  driverCompany,
  sortie,
  sortieStop,
  operationalEvent,
  locationObservation,
  driverMeterReading,
  driverTariff,
  addressBookEntry,
  addressBookCompanyShare,
  addressBookPhoneStar,
};
