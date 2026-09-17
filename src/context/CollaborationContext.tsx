import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { getFirebaseAuth } from "../services/sync/firebaseApp";
import { isSyncFirebaseUser, toSyncUser } from "../services/auth/syncUser";
import { useSubscription } from "./SubscriptionContext";
import {
  createProject,
  ensureUserProfile,
  listMyProjectAccess,
  updateDisplayName,
  updateUsername,
} from "../services/collaboration/collaborationService";
import { canInviteToProject, type Project, type UserProfile } from "../types/collaboration";

type CollaborationContextValue = {
  profile: UserProfile | null;
  projects: Project[];
  inviteableProjects: Project[];
  status: "loading" | "signed_out" | "ready" | "error";
  error: string | null;
  refresh: () => Promise<void>;
  saveUsername: (username: string) => Promise<void>;
  saveDisplayName: (displayName: string) => Promise<void>;
  addProject: (input: Pick<Project, "name" | "description" | "icon" | "tags">) => Promise<Project>;
};

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

export const CollaborationProvider = ({ children }: { children: React.ReactNode }) => {
  const { isCloudSyncEntitled } = useSubscription();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [inviteableProjects, setInviteableProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<CollaborationContextValue["status"]>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!isSyncFirebaseUser(user)) {
      setProfile(null);
      setProjects([]);
      setInviteableProjects([]);
      setStatus("signed_out");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const nextProfile = await ensureUserProfile(toSyncUser(user));
      if (!isCloudSyncEntitled) {
        setProfile(nextProfile);
        setProjects([]);
        setInviteableProjects([]);
        setStatus("ready");
        return;
      }
      const projectAccess = await listMyProjectAccess();
      setProfile(nextProfile);
      setProjects(projectAccess.map(({ project }) => project));
      setInviteableProjects(projectAccess
        .filter(({ project, role }) => canInviteToProject(project, role))
        .map(({ project }) => project));
      setStatus("ready");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "連携情報を読み込めませんでした。");
    }
  }, [isCloudSyncEntitled]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), () => { void refresh(); });
    return unsubscribe;
  }, [refresh]);

  const saveUsername = useCallback(async (username: string) => {
    const next = await updateUsername(username);
    setProfile(next);
  }, []);

  const saveDisplayName = useCallback(async (displayName: string) => {
    const next = await updateDisplayName(displayName);
    setProfile(next);
  }, []);

  const addProject = useCallback(async (
    input: Pick<Project, "name" | "description" | "icon" | "tags">,
  ) => {
    if (!isCloudSyncEntitled) {
      throw new Error("プロジェクト機能を利用するにはTemis Plusへの加入が必要です。");
    }
    const project = await createProject(input);
    setProjects((current) => [project, ...current]);
    setInviteableProjects((current) => [project, ...current]);
    return project;
  }, [isCloudSyncEntitled]);

  const value = useMemo<CollaborationContextValue>(() => ({
    profile, projects, inviteableProjects, status, error, refresh, saveUsername, saveDisplayName, addProject,
  }), [addProject, error, inviteableProjects, profile, projects, refresh, saveDisplayName, saveUsername, status]);

  return <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>;
};

export const useCollaboration = (): CollaborationContextValue => {
  const value = useContext(CollaborationContext);
  if (!value) throw new Error("useCollaboration must be used within CollaborationProvider");
  return value;
};
