import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { AppState } from "react-native";

import { getFirebaseAuth } from "../services/sync/firebaseApp";
import { isSyncFirebaseUser, toSyncUser } from "../services/auth/syncUser";
import {
  createProject,
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

type CollaborationContextValue = {
  profile: UserProfile | null;
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
  const profileRequest = useRef(0);
  const projectRequest = useRef(0);

  const refreshProfile = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!isSyncFirebaseUser(user)) return;
    const request = ++profileRequest.current;
    const current = () => request === profileRequest.current && account.current === user.uid && getFirebaseAuth().currentUser?.uid === user.uid;
    setStatus("loading");
    setError(null);
    try {
      const nextProfile = await ensureUserProfile(toSyncUser(user));
      if (!current()) return;
      setProfile(nextProfile);
      setStatus("ready");
    } catch {
      if (!current()) return;
      setStatus("error");
      setError("プロフィールを読み込めませんでした。通信状態を確認して再試行してください。");
    }
  }, []);

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

  const refresh = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    const uid = isSyncFirebaseUser(user) ? user.uid : null;
    if (account.current !== uid || !uid) {
      account.current = uid;
      ++profileRequest.current;
      ++projectRequest.current;
      setProfile(null);
      setProjects([]);
      setInviteableProjects([]);
      setTemisAccess(null);
      setProjectAccess(null);
      setOverflowProjects([]);
      setError(null);
      setProjectError(null);
    }
    if (!uid) {
      setStatus("signed_out");
      setProjectStatus("signed_out");
      return;
    }
    await Promise.all([refreshProfile(), refreshProjects()]);
  }, [refreshProfile, refreshProjects]);

  useEffect(() => {
    const profileRequests = profileRequest;
    const projectRequests = projectRequest;
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), () => { void refresh(); });
    return () => {
      unsubscribe();
      ++profileRequests.current;
      ++projectRequests.current;
    };
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const saveUsername = useCallback(async (username: string) => {
    const uid = account.current;
    const request = ++profileRequest.current;
    const next = await updateUsername(username);
    if (uid === account.current && uid === getFirebaseAuth().currentUser?.uid && request === profileRequest.current) setProfile(next);
  }, []);

  const saveDisplayName = useCallback(async (displayName: string) => {
    const uid = account.current;
    const request = ++profileRequest.current;
    const next = await updateDisplayName(displayName);
    if (uid === account.current && uid === getFirebaseAuth().currentUser?.uid && request === profileRequest.current) setProfile(next);
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
    profile, projects, inviteableProjects, temisAccess, projectAccess, overflowProjects,
    status, error, projectStatus, projectError, refreshProfile, refreshProjects, refresh, saveUsername, saveDisplayName, addProject, resolveOverflow,
  }), [addProject, error, projectStatus, projectError, refreshProfile, refreshProjects, inviteableProjects, overflowProjects, profile, projectAccess, projects, refresh, resolveOverflow, saveDisplayName, saveUsername, status, temisAccess]);

  return <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>;
};

export const useCollaboration = (): CollaborationContextValue => {
  const value = useContext(CollaborationContext);
  if (!value) throw new Error("useCollaboration must be used within CollaborationProvider");
  return value;
};
