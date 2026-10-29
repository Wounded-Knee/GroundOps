export type User = {
  id: string;
  displayName: string | null;
  email: string | null;
  platformAdministrator: boolean;
};

export type DirectoryCompany = {
  id: string;
  name: string;
  createdAt: string;
};

export type DirectoryFacility = {
  id: string;
  name: string;
  createdAt: string;
};

export type DirectoryUser = {
  id: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
};

export type DirectoryNameRequest = {
  name: string;
};

export type DirectoryUserRequest = {
  displayName: string;
  email: string | null;
};

export type DirectoryCompanyList = {
  companies: DirectoryCompany[];
};

export type DirectoryFacilityList = {
  facilities: DirectoryFacility[];
};

export type DirectoryUserList = {
  users: DirectoryUser[];
};

export type DirectoryMember = {
  userId: string;
  displayName: string | null;
  email: string | null;
  administrator: boolean;
};

export type DirectoryMemberList = {
  members: DirectoryMember[];
};

export type DirectoryMemberRequest = {
  userId: string;
  administrator: boolean;
};

export type CreateSessionRequest = {
  googleIdToken: string;
};

export type CreateSessionResponse = {
  token: string;
  user: User;
};
