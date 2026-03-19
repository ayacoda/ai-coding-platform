import { supabase } from './supabase';

export interface ProjectVersion {
  id: string;
  project_id: string;
  user_id: string;
  label: string | null;
  files: Record<string, string>;
  created_at: string;
}

const MAX_VERSIONS = 50;

export async function saveVersion(
  projectId: string,
  userId: string,
  files: Record<string, string>,
  label?: string
): Promise<string | null> {
  if (!projectId || !userId || Object.keys(files).length === 0) return null;

  const { data, error } = await supabase
    .from('project_versions')
    .insert({ project_id: projectId, user_id: userId, files, label: label ?? null })
    .select('id')
    .single();

  if (error) {
    console.warn('[versions] save failed:', error.message);
    return null;
  }

  // Trim old versions beyond the limit
  const { data: all } = await supabase
    .from('project_versions')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (all && all.length > MAX_VERSIONS) {
    const toDelete = (all as { id: string }[]).slice(MAX_VERSIONS).map((v) => v.id);
    await supabase.from('project_versions').delete().in('id', toDelete);
  }

  return (data as { id: string } | null)?.id ?? null;
}

export async function fetchVersions(projectId: string): Promise<ProjectVersion[]> {
  const { data, error } = await supabase
    .from('project_versions')
    .select('id, project_id, user_id, label, created_at, files')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(MAX_VERSIONS);

  if (error) {
    console.warn('[versions] fetch failed:', error.message);
    return [];
  }
  return (data as ProjectVersion[]) ?? [];
}

export async function deleteVersion(versionId: string): Promise<void> {
  await supabase.from('project_versions').delete().eq('id', versionId);
}
