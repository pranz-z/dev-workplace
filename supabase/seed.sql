-- Development-only seed. It uses the first local auth user and exits safely when
-- no local user exists. It never contains personal production data.
--
-- The seed deliberately covers all three visibility states so the public access
-- tests in tests/rls-phase2b-manual.sql can run on a fresh local database:
--   autocare-booking-system        -> Public
--   ai-customer-service-assistant  -> Public
--   developer-portfolio            -> Public
--   mobile-offline-llm             -> Private
--   autoscan-vehicle-inspection    -> Unlisted
do $$
declare
  seed_user uuid;
  autocare_id uuid;
  agent_id uuid;
  portfolio_id uuid;
  mobile_id uuid;
  autoscan_id uuid;
  tech_nextjs uuid;
  tech_typescript uuid;
  tech_supabase uuid;
  tech_python uuid;
  tech_flutter uuid;
  seed_plan_id uuid;
begin
  select id into seed_user from auth.users order by created_at limit 1;
  if seed_user is null then
    raise notice 'No local auth user found; skipping workspace seed.';
    return;
  end if;

  insert into public.profiles (id, username, display_name, public_profile_enabled)
  values (seed_user, 'demo-builder', 'Demo Builder', true)
  on conflict (id) do nothing;

  insert into public.projects (
    user_id, slug, title, description, project_type, status, workflow_stage, priority,
    is_featured, visibility, role, team_size, start_date, target_date,
    current_objective, next_action,
    public_summary, public_problem, public_solution, public_result,
    repository_url, demo_url, docs_url,
    health_documentation, health_screenshots, health_testing, health_deployment
  )
  values
    (seed_user, 'autocare-booking-system', 'AutoCare Booking System',
     'Customer booking and service workflow for a local auto repair shop.',
     'Client / Portfolio', 'In Development', 'development', 'High', true, 'Public',
     'Full-stack product builder', 2, current_date - 45, current_date + 21,
     'Ship a clear booking and service workflow.', 'Finish the admin chat UI',
     'A booking-first web product that moves a local service business off phone calls and manual scheduling.',
     'Small service businesses lose bookings to fragmented scheduling and unclear service status.',
     'A booking-first product with clear customer flows, admin visibility and conversational updates.',
     'A working prototype that communicates product thinking and UX craft for service businesses.',
     'https://github.com/example/autocare', 'https://autocare-demo.example', 'https://docs.example/autocare',
     true, true, false, true),
    (seed_user, 'ai-customer-service-assistant', 'AI Customer Service Assistant',
     'Retrieval-backed support workflow with grounded context.',
     'AI / Freelance', 'Research', 'research', 'High', true, 'Public',
     'AI product engineer', 1, current_date - 30, current_date + 60,
     'Measure retrieval quality.', 'Define the evaluation flow',
     'A retrieval-backed assistant that answers repeat support questions with grounded, checkable context.',
     'Support teams need reliable answers for repeat questions instead of generic chatbot output.',
     'Retrieval plus contextual prompting, with transparent response quality evaluation.',
     'A practical prototype for AI-assisted support with clear evaluation patterns.',
     'https://github.com/example/customer-agent', null, null,
     true, false, false, false),
    (seed_user, 'developer-portfolio', 'Developer Portfolio',
     'Portfolio and project evidence workspace.',
     'Personal', 'In Development', 'development', 'Medium', true, 'Public',
     'Designer + developer', 1, current_date - 20, current_date + 30,
     'Tell stronger project stories.', 'Polish the case studies',
     'A portfolio that shows how each project moved from problem to shipped result.',
     'Portfolios often list technologies without showing the reasoning behind the build.',
     'Case studies driven by the same project records used for day-to-day delivery.',
     null, null, 'https://portfolio-demo.example', null,
     true, false, false, true),
    (seed_user, 'mobile-offline-llm', 'Mobile Offline LLM',
     'On-device language model experiments for offline field work.',
     'Personal', 'Planning', 'planning', 'Low', false, 'Private',
     'Mobile developer', 1, current_date - 5, current_date + 90,
     'Prove on-device inference on mid-range hardware.', 'Pick the runtime and benchmark it',
     null, null, null, null, null, null, null, false, false, false, false),
    (seed_user, 'autoscan-vehicle-inspection', 'AutoScan Vehicle Inspection',
     'Unlisted pilot for a workshop inspection checklist tool.',
     'Client / Portfolio', 'Testing', 'testing', 'Medium', false, 'Unlisted',
     'Product builder', 1, current_date - 10, current_date + 15,
     'Collect workshop feedback on the inspection flow.', 'Fix the offline sync queue',
     'A small inspection tool used by one pilot workshop before any public release.',
     'Paper inspection sheets get lost and are hard to summarise.',
     'A checklist app that captures inspection evidence on a phone.',
     null, null, null, null, false, false, false, false)
  on conflict (user_id, slug) do nothing;

  select id into autocare_id from public.projects where user_id = seed_user and slug = 'autocare-booking-system';
  select id into agent_id from public.projects where user_id = seed_user and slug = 'ai-customer-service-assistant';
  select id into portfolio_id from public.projects where user_id = seed_user and slug = 'developer-portfolio';
  select id into mobile_id from public.projects where user_id = seed_user and slug = 'mobile-offline-llm';
  select id into autoscan_id from public.projects where user_id = seed_user and slug = 'autoscan-vehicle-inspection';

  insert into public.project_settings (project_id, custom_color, custom_icon, show_repository, show_live_demo)
  values (autocare_id, 'peach', 'sparkles', true, true),
    (agent_id, 'lavender', 'bot', true, false),
    (portfolio_id, 'pink', 'globe', false, true),
    (mobile_id, 'blue', 'smartphone', false, false),
    (autoscan_id, 'green', 'clipboard-check', false, false)
  on conflict (project_id) do nothing;

  if not exists (select 1 from public.milestones where project_id = autocare_id) then
    insert into public.milestones (project_id, title, description, status, target_date, sort_order)
    values (autocare_id, 'Customer booking', 'Validate the customer booking flow.', 'completed', current_date - 14, 1),
      (autocare_id, 'Admin dashboard', 'Complete admin workflow and chat.', 'active', current_date + 7, 2),
      (autocare_id, 'Pilot handover', 'Hand the flow to the workshop team.', 'pending', current_date + 20, 3),
      (agent_id, 'Research sprint', 'Document retrieval and evaluation findings.', 'active', current_date + 10, 1),
      (portfolio_id, 'Case studies', 'Publish project evidence.', 'active', current_date + 18, 1),
      (autoscan_id, 'Workshop pilot', 'Run the inspection pilot and collect feedback.', 'active', current_date + 5, 1);
  end if;

  if not exists (select 1 from public.tasks where project_id = autocare_id) then
    insert into public.tasks (user_id, project_id, milestone_id, title, description, status, priority, due_date)
    select seed_user, autocare_id, m.id, 'Finish admin chat interface',
      'Refine support messaging and responsive states.', 'In Progress', 'High', now() + interval '1 day'
    from public.milestones m
    where m.project_id = autocare_id and m.title = 'Admin dashboard';

    insert into public.tasks (user_id, project_id, milestone_id, title, description, status, priority, due_date, completed_at)
    select seed_user, autocare_id, m.id, 'Customer booking confirmations',
      'Send a clear confirmation after each booking.', 'Completed', 'Medium', now() - interval '3 days', now() - interval '3 days'
    from public.milestones m
    where m.project_id = autocare_id and m.title = 'Customer booking';
  end if;

  insert into public.tasks (user_id, project_id, title, description, status, priority, due_date)
  select seed_user, agent_id, 'Run AI agent benchmark', 'Evaluate retrieval quality with grounded traces.', 'Testing', 'High', now() + interval '4 days'
  where not exists (select 1 from public.tasks where project_id = agent_id and title = 'Run AI agent benchmark');
  insert into public.tasks (user_id, project_id, title, description, status, priority, due_date)
  select seed_user, portfolio_id, 'Prepare portfolio case study', 'Write the problem, solution, and result narrative.', 'Planned', 'Medium', now() + interval '9 days'
  where not exists (select 1 from public.tasks where project_id = portfolio_id and title = 'Prepare portfolio case study');
  insert into public.tasks (user_id, project_id, title, description, status, priority, due_date)
  select seed_user, autoscan_id, 'Fix offline sync queue', 'Retry failed checklist uploads when the network returns.', 'In Progress', 'Critical', now() + interval '2 days'
  where not exists (select 1 from public.tasks where project_id = autoscan_id and title = 'Fix offline sync queue');

  insert into public.plans (user_id, title, description, timeframe, status, target_date)
  select seed_user, 'Launch AutoCare Demo', 'Prepare AutoCare for a client walkthrough.', 'This month', 'Active', current_date + 14
  where not exists (select 1 from public.plans where user_id = seed_user and title = 'Launch AutoCare Demo');
  insert into public.plans (user_id, title, description, timeframe, status, target_date)
  select seed_user, 'Portfolio refresh', 'Strengthen project evidence and public presentation.', 'This month', 'Planning', current_date + 30
  where not exists (select 1 from public.plans where user_id = seed_user and title = 'Portfolio refresh');

  select id into seed_plan_id from public.plans where user_id = seed_user and title = 'Launch AutoCare Demo' order by created_at limit 1;
  if seed_plan_id is not null and not exists (select 1 from public.project_plan_items where plan_id = seed_plan_id) then
    insert into public.project_plan_items (plan_id, project_id, label, done, sort_order)
    values (seed_plan_id, autocare_id, 'Define demo scope', true, 1),
      (seed_plan_id, autocare_id, 'Finish admin chat', false, 2),
      (seed_plan_id, null, 'Rehearse the walkthrough', false, 3);
  end if;

  insert into public.notes (user_id, project_id, title, content)
  select seed_user, autocare_id, 'AutoCare feedback', 'Customers care about quick confirmation and clear service status.'
  where not exists (select 1 from public.notes where user_id = seed_user and title = 'AutoCare feedback');
  insert into public.notes (user_id, project_id, title, content)
  select seed_user, agent_id, 'AI support prompt ideas', 'Keep answers grounded in uploaded manuals and service records.'
  where not exists (select 1 from public.notes where user_id = seed_user and title = 'AI support prompt ideas');

  insert into public.technologies (user_id, name)
  values (seed_user, 'Next.js'), (seed_user, 'TypeScript'), (seed_user, 'Python'),
    (seed_user, 'Supabase'), (seed_user, 'Flutter')
  on conflict do nothing;

  select id into tech_nextjs from public.technologies where user_id = seed_user and name = 'Next.js';
  select id into tech_typescript from public.technologies where user_id = seed_user and name = 'TypeScript';
  select id into tech_supabase from public.technologies where user_id = seed_user and name = 'Supabase';
  select id into tech_python from public.technologies where user_id = seed_user and name = 'Python';
  select id into tech_flutter from public.technologies where user_id = seed_user and name = 'Flutter';

  insert into public.project_technologies (project_id, technology_id)
  values (autocare_id, tech_nextjs), (autocare_id, tech_typescript), (autocare_id, tech_supabase),
    (agent_id, tech_python), (agent_id, tech_nextjs),
    (portfolio_id, tech_nextjs), (portfolio_id, tech_typescript),
    (mobile_id, tech_flutter)
  on conflict do nothing;
end $$;

