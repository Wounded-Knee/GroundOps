/** A place saved for one driver. Nickname and place name may be empty. */
export type AddressBookEntry = {
  id: string;
  nickname: string;
  placeName: string;
  label: string;
  latitude: number;
  longitude: number;
  favorite: boolean;
  owned: boolean;
  companyShared: boolean;
  platformShared: boolean;
};

export type AddressBookEntryWrite = {
  nickname: string;
  placeName: string;
  label: string;
  latitude: number;
  longitude: number;
};

/** At least one field is set. A new label includes both coordinates. */
export type AddressBookEntryPatch = {
  nickname?: string;
  placeName?: string;
  label?: string;
  latitude?: number;
  longitude?: number;
  favorite?: boolean;
};

/** A Groundops star for one postal address on the device. No contact fields. */
export type PhoneAddressStar = {
  contactId: string;
  addressId: string;
};

export type AddressBookResponse = {
  entries: AddressBookEntry[];
  phoneStars: PhoneAddressStar[];
  canShareWithCompany: boolean;
  canShareWithPlatform: boolean;
};
