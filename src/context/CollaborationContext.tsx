import { startPublicationSync } from "../services/guild/guildPublicationQueue";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { AppState } from "react-native";

import { getFirebaseAuth } from "../services/sync/firebaseApp";
import { isSyncFirebaseUser, toSyncUser } from "../services/auth/syncUser";
import {
  createProject,
  completeUserProfile,
  ensureUserProfile,
  updateDisplayName,
  updateUsername,
} from "../services/collaboration/collaborationService";
import {
  refreshProjectAccess,
  resolveProjectOverflow,
  type ProjectAccessState,
  type ProjectOverflowItem,
  type ProjectOverflowResolution,
  type TemisAccessState,
} from "../services/freemium/temisFreemiumService";
import { canInviteToProject, type Project, type UserProfile } from "../types/collaboration";

import { cacheCompletedProfile, clearCompletedProfile, readCompletedProfile } from "../services/collaboration/profileCompletionCache";
import { isProfileComplete } from "../services/collaboration/profilePolicy";
import { removeProfilePhoto, selectAndSaveProfilePhoto } from "../services/collaboration/profilePhotoService";

type CollaborationContextValue = {
  profile: UserProfile | null;
  accountUserId: string | null;
  profileSetupStatus: "checking" | "required" | "complete" | "signed_out" | "error";
  completeProfile: (input: { displayName: string; username: string }) => Promise<void>;
  editPhoto: (remove?: boolean) => Promise<void>;
  projects: Project[];
  inviteableProjects: Project[];
  temisAccess: TemisAccessState | null;
  projectAccess: ProjectAccessState | null;
  overflowProjects: ProjectOverflowItem[];
  status: "loading" | "signed_out" | "ready" | "error";
  error: string | null;
  projectStatus: "loading" | "signed_out" | "ready" | "error";
  projectError: string | null;
  refreshProfile: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refresh: () => Promise<void>;
  saveUsername: (username: string) => Promise<void>;
  saveDisplayName: (displayName: string) => Promise<void>;
  addProject: (input: Pick<Project, "name" | "description" | "icon" | "tags">) => Promise<Project>;
  resolveOverflow: (keepProjectId: string, resolutions: ProjectOverflowResolution[]) => Promise<void>;
};

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

export const CollaborationProvider = ({ children }: { children: React.ReactNode }) => {
  const [accountUserId, setAccountUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [inviteableProjects, setInviteableProjects] = useState<Project[]>([]);
  const [temisAccess, setTemisAccess] = useState<TemisAccessState | null>(null);
  const [projectAccess, setProjectAccess] = useState<ProjectAccessState | null>(null);
  const [overflowProjects, setOverflowProjects] = useState<ProjectOverflowItem[]>([]);
  const [status, setStatus] = useState<CollaborationContextValue["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [projectStatus, setProjectStatus] = useState<CollaborationContextValue["projectStatus"]>("loading");
  const [projectError, setProjectError] = useState<string | null>(null);
  const account = useRef<string | null>(null);
  const [profileSetupStatus, setProfileSetupStatus] = useState<CollaborationContextValue["profileSetupStatus"]>("checking");
  const completion = useRef<CollaborationContextValue["profileSetupStatus"]>("checking");
  const authObserved = useRef(false);
  const accountGeneration = useRef(0);
  const setGate = useCallback((state: CollaborationContextValue["profileSetupStatus"]) => {
    completion.current = state;
    setProfileSetupStatus(state);
  }, []);
  const profileRequest = useRef(0);
  const projectRequest = useRef(0);

  const refreshProfile = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!isSyncFirebaseUser(user)) return;
    const request = ++profileRequest.current;
    const current = () => request === profileRequest.current && account.current === user.uid && getFirebaseAuth().currentUser?.uid === user.uid;
    if (completion.current !== "complete") setStatus("loading");
    if (completion.current === "error") setGate("checking");
    setError(null);
    try {
      const nextProfile = await ensureUserProfile(toSyncUser(user));
      if (!current()) return;
      setProfile((previous) => previous && previous.userId === nextProfile.userId && previous.updatedAt > nextProfile.updatedAt ? previous : nextProfile);
      setStatus("ready");
      if (completion.current !== "complete") setGate(isProfileComplete(nextProfile) ? "complete" : "required");
      if (completion.current === "complete") void cacheCompletedProfile(nextProfile);
    } catch {
      if (!current()) return;
      setStatus(completion.current === "complete" ? "ready" : "error");
      if (completion.current !== "complete") setGate("error");
      setError("プロフィールを読み込めませんでした。通信状態を確認して再試行してください。");
    }
  }, [setGate]);

  const refreshProjects = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!isSyncFirebaseUser(user)) return;
    const request = ++projectRequest.current;
    const current = () => request === projectRequest.current && account.current === user.uid && getFirebaseAuth().currentUser?.uid === user.uid;
    setProjectStatus("loading");
    setProjectError(null);
    setProjects([]);
    setOverflowProjects([]);
    setInviteableProjects([]);
    setProjectAccess(null);
    setTemisAccess(null);
    try {
      const access = await refreshProjectAccess();
      if (!current()) return;
      setTemisAccess(access.access);
      setProjectAccess(access.state);
      setOverflowProjects(access.projects);
      setProjects(access.projects.map(({ project }) => project));
      setInviteableProjects(access.projects
        .filter(({ project, role }) => canInviteToProject(project, role))
        .map(({ project }) => project));
      setProjectStatus("ready");
    } catch {
      if (!current()) return;
      setProjectStatus("error");
      setProjectError("プロジェクトの利用状態を確認できませんでした。しばらくしてから再試行してください。");
    }
  }, []);

  const resetAccount = useCallback((uid: string | null) => {
    const previous = account.current;
    if (previous) void clearCompletedProfile(previous);
    account.current = uid;
    ++accountGeneration.current;
    ++profileRequest.current;
    ++projectRequest.current;
    setAccountUserId(uid);
    setGate(uid ? "checking" : "signed_out");
    setStatus(uid ? "loading" : "signed_out");
    setProjectStatus(uid ? "loading" : "signed_out");
    setProfile(null);
    setProjects([]); setInviteableProjects([]); setOverflowProjects([]);
    setTemisAccess(null); setProjectAccess(null);
    setError(null); setProjectError(null);
  }, [setGate]);

  useEffect(() => accountUserId ? startPublicationSync(accountUserId) : undefined, [accountUserId]);

  const refresh = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    const uid = isSyncFirebaseUser(user) ? user.uid : null;
    if (account.current !== uid) resetAccount(uid);
    if (!uid) return;
    await Promise.all([refreshProfile(), refreshProjects()]);
  }, [refreshProfile, refreshProjects, resetAccount]);

  useEffect(() => {
    let alive = true;
    const generationRef = accountGeneration;
    const profileRequests = profileRequest;
    const projectRequests = projectRequest;
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      const restored = !authObserved.current;
      authObserved.current = true;
      const uid = isSyncFirebaseUser(user) ? user.uid : null;
      resetAccount(uid);
      if (!uid) return;
      if (!restored) void clearCompletedProfile(uid);
      const generation = accountGeneration.current;
      void (async () => {
        // Only cold-start restoration may reuse the cache. Every fresh login verifies on the server.
        if (restored) {
          const cached = await readCompletedProfile(uid);
          if (!alive || generation !== accountGeneration.current || getFirebaseAuth().currentUser?.uid !== uid) return;
          if (cached) { setProfile(cached); setGate("complete"); setStatus("ready"); }
        }
        if (!alive || generation !== accountGeneration.current) return;
        await Promise.all([refreshProfile(), refreshProjects()]);
      })();
    });
    return () => {
      alive = false; unsubscribe();
      ++generationRef.current; ++profileRequests.current; ++projectRequests.current;
    };
  }, [refreshProfile, refreshProjects, resetAccount, setGate]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const saveUsername = useCallback(async (username: string) => {
    const uid = account.current;
    if (!uid || uid !== getFirebaseAuth().currentUser?.uid) throw new Error("アカウントが切り替わりました。もう一度お試しください。");
    const request = ++profileRequest.current;
    const next = await updateUsername(username);
    if (uid === account.current && uid === getFirebaseAuth().currentUser?.uid && request === profileRequest.current) { setProfile(next); setStatus("ready"); if (completion.current === "complete") void cacheCompletedProfile(next); }
  }, []);

  const saveDisplayName = useCallback(async (displayName: string) => {
    const uid = account.current;
    if (!uid || uid !== getFirebaseAuth().currentUser?.uid) throw new Error("アカウントが切り替わりました。もう一度お試しください。");
    const request = ++profileRequest.current;
    const next = await updateDisplayName(displayName);
    if (uid === account.current && uid === getFirebaseAuth().currentUser?.uid && request === profileRequest.current) { setProfile(next); setStatus("ready"); if (completion.current === "complete") void cacheCompletedProfile(next); }
  }, []);

  const completeProfile = useCallback(async (input: { displayName: string; username: string }) => {
    const uid = account.current;
    if (!uid || uid !== getFirebaseAuth().currentUser?.uid) throw new Error("アカウントが切り替わりました。もう一度お試しください。");
    const next = await completeUserProfile(input);
    if (uid === account.current && uid === getFirebaseAuth().currentUser?.uid) {
      setProfile((previous) => !previous || previous.updatedAt <= next.updatedAt ? next : previous);
      setStatus("ready");
      setGate("complete");
      void cacheCompletedProfile(next);
    }
  }, [setGate]);

  const editPhoto = useCallback(async (remove = false) => {
    const uid = account.current;
    if (!uid || uid !== getFirebaseAuth().currentUser?.uid) throw new Error("アカウントが切り替わりました。もう一度お試しください。");
    const next = await (remove ? removeProfilePhoto() : selectAndSaveProfilePhoto());
    if (next && uid === account.current && uid === getFirebaseAuth().currentUser?.uid) {
      setProfile((previous) => !previous || previous.updatedAt <= next.updatedAt ? next : previous);
      setStatus("ready");
      if (completion.current === "complete") void cacheCompletedProfile(next);
    }
  }, []);

  const addProject = useCallback(async (
    input: Pick<Project, "name" | "description" | "icon" | "tags">,
  ) => {
    if (projectStatus !== "ready") throw new Error("プロジェクトの利用状態を確認してから再試行してください。");
    const project = await createProject(input);
    await refresh();
    return project;
  }, [projectStatus, refresh]);

  const resolveOverflow = useCallback(async (
    keepProjectId: string,
    resolutions: ProjectOverflowResolution[],
  ) => {
    if (projectStatus !== "ready") throw new Error("プロジェクトの利用状態を確認してから再試行してください。");
    await resolveProjectOverflow(keepProjectId, resolutions);
    await refresh();
  }, [projectStatus, refresh]);

  const value = useMemo<CollaborationContextValue>(() => ({
    profile, accountUserId, profileSetupStatus, completeProfile, editPhoto, projects, inviteableProjects, temisAccess, projectAccess, overflowProjects,
    status, error, projectStatus, projectError, refreshProfile, refreshProjects, refresh, saveUsername, saveDisplayName, addProject, resolveOverflow,
  }), [accountUserId, profileSetupStatus, completeProfile, editPhoto, addProject, error, projectStatus, projectError, refreshProfile, refreshProjects, inviteableProjects, overflowProjects, profile, projectAccess, projects, refresh, resolveOverflow, saveDisplayName, saveUsername, status, temisAccess]);

  return <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>;
};

export const useCollaboration = (): CollaborationContextValue => {
  const value = useContext(CollaborationContext);
  if (!value) throw new Error("useCollaboration must be used within CollaborationProvider");
  return value;
};
