drop policy if exists "Gestores consultan perfiles para asignar tareas" on public.user_access;
create policy "Gestores consultan perfiles para asignar tareas"
  on public.user_access for select to authenticated
  using (public.has_permission('tasks_manage'));
