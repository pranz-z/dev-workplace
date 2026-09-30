-- Development-only seed. It uses the first local auth user and exits safely
-- when no local user exists. It never contains personal production data.
do $$
declare
  seed_user uuid;
  autocare_id uuid;
  agent_id uuid;
  portfolio_id uuid;
begin
  select id into seed_user from auth.users order by created_at limit 1;
  if seed_user is null then
    raise notice 'No local auth user found; skipping workspace seed.';
    return;
  end if;

  insert into public.profiles (id, username, display_name, public_profile_enabled)
  values (seed_user, 'demo-builder', 'Demo Builder', true)
  on conflict (id) do nothing;

  insert into public.projects (user_id, slug, title, description, project_type, status, workflow_stage, priority, is_featured, visibility, role, current_objective, next_action)
  values (seed_user, 'autocare-booking-system', 'AutoCare Booking System', 'Customer booking and service workflow for a local auto repair shop.', 'Client / Portfolio', 'In Development', 'DEVELOPMENT', 'High', true, 'Public', 'Full-stack product builder', 'Ship a clear booking and service workflow.', 'Finish the admin chat UI'),
    (seed_user, 'ai-customer-service-assistant', 'AI Customer Service Assistant', 'Retrieval-backed support workflow with grounded context.', 'AI / Freelance', 'Research', 'RESEARCH', 'High', true, 'Public', 'AI product engineer', 'Measure retrieval quality.', 'Define the evaluation flow'),
    (seed_user, 'developer-portfolio', 'Developer Portfolio', 'Portfolio and project evidence workspace.', 'Personal', 'In Development', 'DEVELOPMENT', 'Medium', true, 'Public', 'Designer + developer', 'Tell stronger project stories.', 'Polish the case studies')
  on conflict (user_id, slug) do nothing;

  select id into autocare_id from public.projects where user_id = seed_user and slug = 'autocare-booking-system';
  select id into agent_id from public.projects where user_id = seed_user and slug = 'ai-customer-service-assistant';
  select id into portfolio_id from public.projects where user_id = seed_user and slug = 'developer-portfolio';

  insert into public.milestones (project_id, title, description, status, sort_order)
  values (autocare_id, 'Customer booking', 'Validate the customer booking flow.', 'completed', 1),
    (autocare_id, 'Admin dashboard', 'Complete admin workflow and chat.', 'active', 2),
    (agent_id, 'Research sprint', 'Document retrieval and evaluation findings.', 'active', 1),
    (portfolio_id, 'Case studies', 'Publish project evidence.', 'active', 1);

  insert into public.tasks (user_id, project_id, title, description, status, priority)
  values (seed_user, autocare_id, 'Finish admin chat interface', 'Refine support messaging and responsive states.', 'In Progress', 'High'),
    (seed_user, agent_id, 'Run AI agent benchmark', 'Evaluate retrieval quality with grounded traces.', 'Testing', 'High'),
    (seed_user, portfolio_id, 'Prepare portfolio case study', 'Write the problem, solution, and result narrative.', 'Planned', 'Medium');

  insert into public.plans (user_id, title, description, timeframe, status, target_date)
  values (seed_user, 'Launch AutoCare Demo', 'Prepare AutoCare for a client walkthrough.', 'This month', 'Planning', current_date + 14),
    (seed_user, 'Portfolio refresh', 'Strengthen project evidence and public presentation.', 'This month', 'Planning', current_date + 30);

  insert into public.notes (user_id, project_id, title, content)
  values (seed_user, autocare_id, 'AutoCare feedback', 'Customers care about quick confirmation and clear service status.'),
    (seed_user, agent_id, 'AI support prompt ideas', 'Keep answers grounded in uploaded manuals and service records.');

  insert into public.technologies (user_id, name)
  values (seed_user, 'Next.js'), (seed_user, 'TypeScript'), (seed_user, 'Python'), (seed_user, 'Supabase')
  on conflict (user_id, name) do nothing;
end $$;
