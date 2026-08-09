import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { getFirebaseAuth } from "../services/sync/firebaseApp";
import { isGoogleSyncFirebaseUser, type GoogleSyncUser } from "../services/auth/googleSignIn";
import {
  createProject,
  ensureUserProfile,
  listMyProjects,
  updateDisplayName,
  updateUsername,
} from "../services/collaboration/collaborationService";
import type { Project, UserProfile } from "../types/collaboration";

type CollaborationContextValue = {
  profile: UserProfile | null;
  projects: Project[];
  status: "loading" | "signed_out" | "ready" | "error";
  error: string | null;
  refresh: () => Promise<void>;
  saveUsername: (username: string) => Promise<void>;
  saveDisplayName: (displayName: string) => Promise<void>;
  addProject: (input: Pick<Project, "name" | "description" | "icon" | "tags">) => Promise<Project>;
};

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

const toGoogleUser = (user: { uid: string; email: string | null; displayName: string | null }): GoogleSyncUser => ({
  id: user.uid, email: user.email, name: user.displayName,
});

export const CollaborationProvider = ({ children }: { children: React.ReactNode }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<CollaborationContextValue["status"]>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!isGoogleSyncFirebaseUser(user)) {
      setProfile(null);
      setProjects([]);
      setStatus("signed_out");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const nextProfile = await ensureUserProfile(toGoogleUser(user));
      const nextProjects = await listMyProjects();
      setProfile(nextProfile);
      setProjects(nextProjects);
      setStatus("ready");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "連携情報を読み込めませんでした。");
    }
  }, []);

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
    const project = await createProject(input);
    setProjects((current) => [project, ...current]);
    return project;
  }, []);

  const value = useMemo<CollaborationContextValue>(() => ({
    profile, projects, status, error, refresh, saveUsername, saveDisplayName, addProject,
  }), [addProject, error, profile, projects, refresh, saveDisplayName, saveUsername, status]);

  return <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>;
};

export const useCollaboration = (): CollaborationContextValue => {
  const value = useContext(CollaborationContext);
  if (!value) throw new Error("useCollaboration must be used within CollaborationProvider");
  return value;
};
