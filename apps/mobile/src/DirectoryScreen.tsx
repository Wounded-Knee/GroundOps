import type { DirectoryCompany, DirectoryFacility, DirectoryMember, DirectoryUser } from "@groundops/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import {
  createCompany,
  createDirectoryUser,
  createFacility,
  deleteCompany,
  deleteCompanyMember,
  deleteDirectoryUser,
  deleteFacility,
  putCompanyMember,
  readCompanies,
  readCompanyMembers,
  readDirectoryUsers,
  readFacilities,
  updateCompany,
  updateDirectoryUser,
  updateFacility,
  type DirectoryFailure,
} from "./directoryClient";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";

const apiUrl = resolveApiUrl();
const couldNotLoad = "The directory could not be loaded.";
const notSaved = "That was not saved.";
const stillInUse = "This record is still in use.";
const notFound = "That record is no longer there.";
const forbidden = "You cannot change the directory.";

type EditState =
  | { kind: "company"; id: string; name: string }
  | { kind: "facility"; id: string; name: string }
  | { kind: "user"; id: string; displayName: string; email: string }
  | null;

type PendingDelete = { kind: "company" | "facility" | "user"; id: string; label: string } | null;

export function DirectoryScreen({
  token,
  onUnauthorized,
}: {
  token: string;
  onUnauthorized: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [companies, setCompanies] = useState<DirectoryCompany[]>([]);
  const [membersByCompany, setMembersByCompany] = useState<Record<string, DirectoryMember[]>>({});
  const [memberDraft, setMemberDraft] = useState<{ companyId: string; userId: string; administrator: boolean } | null>(null);
  const [facilities, setFacilities] = useState<DirectoryFacility[]>([]);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [edit, setEdit] = useState<EditState>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const fail = useCallback((result: DirectoryFailure): boolean => {
    if (result === "unauthorized") {
      onUnauthorizedRef.current();
      return true;
    }
    return false;
  }, []);

  const loadCompanies = useCallback(async (): Promise<DirectoryFailure | "ok"> => {
    const result = await readCompanies(apiUrl, token);
    if (typeof result === "string") {
      return result;
    }
    const members: Record<string, DirectoryMember[]> = {};
    for (const company of result.companies) {
      const listed = await readCompanyMembers(apiUrl, token, company.id);
      if (typeof listed === "string") {
        return listed;
      }
      members[company.id] = listed.members;
    }
    setCompanies(result.companies);
    setMembersByCompany(members);
    return "ok";
  }, [token]);

  const loadFacilities = useCallback(async (): Promise<DirectoryFailure | "ok"> => {
    const result = await readFacilities(apiUrl, token);
    if (typeof result === "string") {
      return result;
    }
    setFacilities(result.facilities);
    return "ok";
  }, [token]);

  const loadUsers = useCallback(async (): Promise<DirectoryFailure | "ok"> => {
    const result = await readDirectoryUsers(apiUrl, token);
    if (typeof result === "string") {
      return result;
    }
    setUsers(result.users);
    return "ok";
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setMessage(null);
      const loaded = [await loadCompanies(), await loadFacilities(), await loadUsers()];
      if (cancelled) {
        return;
      }
      const failure = loaded.find((result) => result !== "ok");
      if (failure) {
        if (!fail(failure)) {
          setMessage(couldNotLoad);
        }
        return;
      }
      setReady(true);
    }
    void load().catch(() => {
      if (!cancelled) {
        setMessage(couldNotLoad);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fail, loadCompanies, loadFacilities, loadUsers]);

  function explain(result: DirectoryFailure): string {
    if (result === "in-use") {
      return stillInUse;
    }
    if (result === "missing") {
      return notFound;
    }
    if (result === "forbidden") {
      return forbidden;
    }
    if (result === "invalid") {
      return notSaved;
    }
    return couldNotLoad;
  }

  async function runDirectoryWrite<T>(
    request: () => Promise<T>,
    succeeded: (result: T) => boolean,
  ): Promise<T | null> {
    if (busy) {
      return null;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await request();
      if (!succeeded(result)) {
        if (typeof result === "string") {
          const failure = result as DirectoryFailure;
          if (!fail(failure)) {
            setMessage(explain(failure));
          }
        }
        return null;
      }
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function reloadDirectory(loaded: DirectoryFailure | "ok"): Promise<void> {
    if (loaded !== "ok" && !fail(loaded)) {
      setMessage(couldNotLoad);
    }
  }

  async function addCompany(): Promise<void> {
    const result = await runDirectoryWrite(
      () => createCompany(apiUrl, token, companyName),
      (value) => typeof value !== "string",
    );
    if (!result) {
      return;
    }
    setCompanyName("");
    setEdit(null);
    await reloadDirectory(await loadCompanies());
  }

  async function reloadMembers(companyId: string): Promise<void> {
    const listed = await readCompanyMembers(apiUrl, token, companyId);
    if (typeof listed === "string") {
      if (!fail(listed)) {
        setMessage(explain(listed));
      }
      return;
    }
    setMembersByCompany((current) => ({ ...current, [companyId]: listed.members }));
  }

  async function saveMember(companyId: string): Promise<void> {
    if (!memberDraft || memberDraft.companyId !== companyId || memberDraft.userId.length === 0) {
      return;
    }
    const draft = memberDraft;
    const result = await runDirectoryWrite(
      () =>
        putCompanyMember(apiUrl, token, companyId, {
          userId: draft.userId,
          administrator: draft.administrator,
        }),
      (value) => typeof value !== "string",
    );
    if (!result) {
      return;
    }
    setMemberDraft(null);
    await reloadMembers(companyId);
  }

  async function toggleMember(companyId: string, member: DirectoryMember): Promise<void> {
    const result = await runDirectoryWrite(
      () =>
        putCompanyMember(apiUrl, token, companyId, {
          userId: member.userId,
          administrator: !member.administrator,
        }),
      (value) => typeof value !== "string",
    );
    if (!result) {
      return;
    }
    await reloadMembers(companyId);
  }

  async function removeMember(company: DirectoryCompany, member: DirectoryMember): Promise<void> {
    const result = await runDirectoryWrite(
      () => deleteCompanyMember(apiUrl, token, company.id, member.userId),
      (value) => value === "ok",
    );
    if (!result) {
      return;
    }
    await reloadMembers(company.id);
  }

  async function addFacility(): Promise<void> {
    const result = await runDirectoryWrite(
      () => createFacility(apiUrl, token, facilityName),
      (value) => typeof value !== "string",
    );
    if (!result) {
      return;
    }
    setFacilityName("");
    setEdit(null);
    await reloadDirectory(await loadFacilities());
  }

  async function addUser(): Promise<void> {
    const result = await runDirectoryWrite(
      () =>
        createDirectoryUser(apiUrl, token, {
          displayName: userName,
          email: userEmail.trim().length > 0 ? userEmail : null,
        }),
      (value) => typeof value !== "string",
    );
    if (!result) {
      return;
    }
    setUserName("");
    setUserEmail("");
    setEdit(null);
    await reloadDirectory(await loadUsers());
  }

  async function saveEdit(): Promise<void> {
    if (!edit) {
      return;
    }
    const current = edit;
    if (current.kind === "company") {
      const result = await runDirectoryWrite(
        () => updateCompany(apiUrl, token, current.id, current.name),
        (value) => typeof value !== "string",
      );
      if (!result) {
        return;
      }
      setEdit(null);
      await reloadDirectory(await loadCompanies());
      return;
    }
    if (current.kind === "facility") {
      const result = await runDirectoryWrite(
        () => updateFacility(apiUrl, token, current.id, current.name),
        (value) => typeof value !== "string",
      );
      if (!result) {
        return;
      }
      setEdit(null);
      await reloadDirectory(await loadFacilities());
      return;
    }
    const result = await runDirectoryWrite(
      () =>
        updateDirectoryUser(apiUrl, token, current.id, {
          displayName: current.displayName,
          email: current.email.trim().length > 0 ? current.email : null,
        }),
      (value) => typeof value !== "string",
    );
    if (!result) {
      return;
    }
    setEdit(null);
    await reloadDirectory(await loadUsers());
  }

  async function removeCompany(row: DirectoryCompany): Promise<void> {
    const result = await runDirectoryWrite(
      () => deleteCompany(apiUrl, token, row.id),
      (value) => value === "ok",
    );
    if (!result) {
      return;
    }
    if (edit?.kind === "company" && edit.id === row.id) {
      setEdit(null);
    }
    await reloadDirectory(await loadCompanies());
  }

  async function removeFacility(row: DirectoryFacility): Promise<void> {
    const result = await runDirectoryWrite(
      () => deleteFacility(apiUrl, token, row.id),
      (value) => value === "ok",
    );
    if (!result) {
      return;
    }
    if (edit?.kind === "facility" && edit.id === row.id) {
      setEdit(null);
    }
    await reloadDirectory(await loadFacilities());
  }

  async function removeUser(row: DirectoryUser): Promise<void> {
    const result = await runDirectoryWrite(
      () => deleteDirectoryUser(apiUrl, token, row.id),
      (value) => value === "ok",
    );
    if (!result) {
      return;
    }
    if (edit?.kind === "user" && edit.id === row.id) {
      setEdit(null);
    }
    await reloadDirectory(await loadUsers());
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Directory</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Text style={styles.section}>Companies</Text>
      <View style={styles.addRow}>
        <TextInput
          accessibilityLabel="New company name"
          value={companyName}
          onChangeText={setCompanyName}
          placeholder="Company name"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <Pressable accessibilityLabel="Add company" onPress={() => void addCompany()} style={styles.addButton}>
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
      {ready && companies.length === 0 ? <Text style={styles.empty}>No companies.</Text> : null}
      {companies.map((row) => {
        const members = membersByCompany[row.id] ?? [];
        const draft = memberDraft?.companyId === row.id ? memberDraft : null;
        const memberIds = new Set(members.map((member) => member.userId));
        const candidates = users.filter((person) => !memberIds.has(person.id));
        return (
          <View key={row.id}>
            <NamedRow
              name={row.name}
              editing={edit?.kind === "company" && edit.id === row.id ? edit.name : null}
              onChangeName={(name) => setEdit({ kind: "company", id: row.id, name })}
              onEdit={() => {
                setPendingDelete(null);
                setEdit({ kind: "company", id: row.id, name: row.name });
              }}
              onCancel={() => setEdit(null)}
              onSave={() => void saveEdit()}
              confirming={pendingDelete?.kind === "company" && pendingDelete.id === row.id}
              onDelete={() => setPendingDelete({ kind: "company", id: row.id, label: row.name })}
              onCancelDelete={() => setPendingDelete(null)}
              onConfirmDelete={() => void removeCompany(row)}
            />
            <View style={styles.members}>
              <Text style={styles.memberLabel}>Members</Text>
              {members.length === 0 ? <Text style={styles.empty}>No members.</Text> : null}
              {members.map((member) => {
                const label = personLabel(member);
                return (
                  <View key={member.userId} style={styles.memberRow}>
                    <Text style={styles.memberName}>{label}</Text>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: member.administrator }}
                      accessibilityLabel={`Administrator ${label} at ${row.name}`}
                      onPress={() => void toggleMember(row.id, member)}
                      style={styles.textButton}
                    >
                      <Text style={[styles.textButtonLabel, member.administrator ? styles.memberOn : null]}>Administrator</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Remove ${label} from ${row.name}`}
                      onPress={() => void removeMember(row, member)}
                      style={styles.textButton}
                    >
                      <Text style={styles.textButtonLabel}>Remove</Text>
                    </Pressable>
                  </View>
                );
              })}
              {draft ? (
                <View style={styles.memberDraft}>
                  {candidates.length === 0 ? <Text style={styles.empty}>No users to add.</Text> : null}
                  {candidates.map((person) => {
                    const label = personLabel(person);
                    const selected = draft.userId === person.id;
                    return (
                      <Pressable
                        key={person.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={label}
                        onPress={() =>
                          setMemberDraft({ companyId: row.id, userId: person.id, administrator: draft.administrator })
                        }
                      >
                        <Text style={[styles.memberName, selected ? styles.memberOn : null]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: draft.administrator }}
                    accessibilityLabel="Administrator"
                    onPress={() => setMemberDraft({ ...draft, administrator: !draft.administrator })}
                    style={styles.textButton}
                  >
                    <Text style={[styles.textButtonLabel, draft.administrator ? styles.memberOn : null]}>Administrator</Text>
                  </Pressable>
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityLabel={`Save member ${row.name}`}
                      onPress={() => void saveMember(row.id)}
                      style={styles.textButton}
                    >
                      <Text style={styles.textButtonLabel}>Add</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Cancel member ${row.name}`}
                      onPress={() => setMemberDraft(null)}
                      style={styles.textButton}
                    >
                      <Text style={styles.textButtonLabel}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityLabel={`Add member to ${row.name}`}
                  onPress={() => setMemberDraft({ companyId: row.id, userId: "", administrator: false })}
                  style={styles.textButton}
                >
                  <Text style={styles.textButtonLabel}>Add member</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}

      <Text style={styles.section}>Facilities</Text>
      <View style={styles.addRow}>
        <TextInput
          accessibilityLabel="New facility name"
          value={facilityName}
          onChangeText={setFacilityName}
          placeholder="Facility name"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <Pressable accessibilityLabel="Add facility" onPress={() => void addFacility()} style={styles.addButton}>
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
      {ready && facilities.length === 0 ? <Text style={styles.empty}>No facilities.</Text> : null}
      {facilities.map((row) => (
        <NamedRow
          key={row.id}
          name={row.name}
          editing={edit?.kind === "facility" && edit.id === row.id ? edit.name : null}
          onChangeName={(name) => setEdit({ kind: "facility", id: row.id, name })}
          onEdit={() => {
            setPendingDelete(null);
            setEdit({ kind: "facility", id: row.id, name: row.name });
          }}
          onCancel={() => setEdit(null)}
          onSave={() => void saveEdit()}
          confirming={pendingDelete?.kind === "facility" && pendingDelete.id === row.id}
          onDelete={() => setPendingDelete({ kind: "facility", id: row.id, label: row.name })}
          onCancelDelete={() => setPendingDelete(null)}
          onConfirmDelete={() => void removeFacility(row)}
        />
      ))}

      <Text style={styles.section}>Users</Text>
      <TextInput
        accessibilityLabel="New user display name"
        value={userName}
        onChangeText={setUserName}
        placeholder="Display name"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
      />
      <View style={styles.addRow}>
        <TextInput
          accessibilityLabel="New user email"
          value={userEmail}
          onChangeText={setUserEmail}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />
        <Pressable accessibilityLabel="Add user" onPress={() => void addUser()} style={styles.addButton}>
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
      {ready && users.length === 0 ? <Text style={styles.empty}>No users.</Text> : null}
      {users.map((row) => {
        const label = row.displayName ?? row.email ?? "User";
        const editing = edit?.kind === "user" && edit.id === row.id ? edit : null;
        return (
          <View key={row.id} style={styles.row}>
            {editing ? (
              <View style={styles.editStack}>
                <TextInput
                  accessibilityLabel={`Edit display name ${label}`}
                  value={editing.displayName}
                  onChangeText={(displayName) => setEdit({ kind: "user", id: row.id, displayName, email: editing.email })}
                  style={styles.input}
                />
                <TextInput
                  accessibilityLabel={`Edit email ${label}`}
                  value={editing.email}
                  onChangeText={(email) =>
                    setEdit({ kind: "user", id: row.id, displayName: editing.displayName, email })
                  }
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="Email"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
                <View style={styles.actions}>
                  <Pressable accessibilityLabel={`Save user ${label}`} onPress={() => void saveEdit()} style={styles.textButton}>
                    <Text style={styles.textButtonLabel}>Save</Text>
                  </Pressable>
                  <Pressable accessibilityLabel={`Cancel user ${label}`} onPress={() => setEdit(null)} style={styles.textButton}>
                    <Text style={styles.textButtonLabel}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{label}</Text>
                  {row.email ? <Text style={styles.rowMeta}>{row.email}</Text> : <Text style={styles.rowMeta}>No email</Text>}
                </View>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityLabel={`Edit user ${label}`}
                    onPress={() =>
                      setEdit({ kind: "user", id: row.id, displayName: row.displayName ?? "", email: row.email ?? "" })
                    }
                    style={styles.textButton}
                  >
                    <Text style={styles.textButtonLabel}>Edit</Text>
                  </Pressable>
                  {pendingDelete?.kind === "user" && pendingDelete.id === row.id ? (
                    <>
                      <Pressable
                        accessibilityLabel={`Confirm delete user ${label}`}
                        onPress={() => void removeUser(row)}
                        style={styles.textButton}
                      >
                        <Text style={styles.textButtonLabel}>Confirm delete</Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`Cancel delete user ${label}`}
                        onPress={() => setPendingDelete(null)}
                        style={styles.textButton}
                      >
                        <Text style={styles.textButtonLabel}>Cancel</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      accessibilityLabel={`Delete user ${label}`}
                      onPress={() => setPendingDelete({ kind: "user", id: row.id, label })}
                      style={styles.textButton}
                    >
                      <Text style={styles.textButtonLabel}>Delete</Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function personLabel(person: { displayName: string | null; email: string | null }): string {
  return person.displayName ?? person.email ?? "User";
}

function NamedRow({
  name,
  editing,
  onChangeName,
  onEdit,
  onCancel,
  onSave,
  confirming,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  name: string;
  editing: string | null;
  onChangeName: (name: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  confirming: boolean;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.row}>
      {editing !== null ? (
        <View style={styles.editStack}>
          <TextInput
            accessibilityLabel={`Edit name ${name}`}
            value={editing}
            onChangeText={onChangeName}
            style={styles.input}
          />
          <View style={styles.actions}>
            <Pressable accessibilityLabel={`Save ${name}`} onPress={onSave} style={styles.textButton}>
              <Text style={styles.textButtonLabel}>Save</Text>
            </Pressable>
            <Pressable accessibilityLabel={`Cancel ${name}`} onPress={onCancel} style={styles.textButton}>
              <Text style={styles.textButtonLabel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.rowTitle}>{name}</Text>
          <View style={styles.actions}>
            <Pressable accessibilityLabel={`Edit ${name}`} onPress={onEdit} style={styles.textButton}>
              <Text style={styles.textButtonLabel}>Edit</Text>
            </Pressable>
            {confirming ? (
              <>
                <Pressable accessibilityLabel={`Confirm delete ${name}`} onPress={onConfirmDelete} style={styles.textButton}>
                  <Text style={styles.textButtonLabel}>Confirm delete</Text>
                </Pressable>
                <Pressable accessibilityLabel={`Cancel delete ${name}`} onPress={onCancelDelete} style={styles.textButton}>
                  <Text style={styles.textButtonLabel}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <Pressable accessibilityLabel={`Delete ${name}`} onPress={onDelete} style={styles.textButton}>
                <Text style={styles.textButtonLabel}>Delete</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: {
      padding: 20,
      gap: 12,
      paddingBottom: 32,
    },
    title: {
      fontSize: 28,
      fontWeight: "600",
      color: colors.text,
    },
    section: {
      marginTop: 8,
      fontSize: 13,
      fontWeight: "600",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: colors.textMuted,
    },
    message: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    empty: {
      fontSize: 16,
      color: colors.textMuted,
    },
    addRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    input: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 10,
      fontSize: 16,
      backgroundColor: colors.surface,
      color: colors.text,
    },
    addButton: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    addButtonText: {
      color: colors.primaryText,
      fontSize: 16,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    members: {
      gap: 8,
      paddingLeft: 12,
      paddingBottom: 8,
    },
    memberDraft: {
      gap: 8,
    },
    memberLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textMuted,
    },
    memberRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    memberName: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
    },
    memberOn: {
      fontWeight: "600",
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
    },
    rowMeta: {
      fontSize: 13,
      color: colors.textMuted,
    },
    editStack: {
      flex: 1,
      gap: 8,
    },
    actions: {
      flexDirection: "row",
      gap: 12,
    },
    textButton: {
      paddingVertical: 4,
    },
    textButtonLabel: {
      fontSize: 16,
      color: colors.accent,
    },
  });
}
