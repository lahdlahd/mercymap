-- MERCYMAP demo data: Hope Harvest Chapel, Akure.
--
-- EVERYTHING HERE IS FICTIONAL. The church, staff, volunteers, partners,
-- people asking for help, their stories and phone numbers are invented for
-- the demo. Phone numbers use the 0800 000 XXXX placeholder pattern.
--
-- Before running: in Supabase, Authentication -> Users -> Add user ->
-- Create new user, tick "Auto Confirm User", and create the three demo
-- accounts below (any password you will remember). If you use different
-- addresses, change the three lines marked DEMO ACCOUNTS.
--
-- How it works: every step goes through MERCYMAP's own database functions,
-- acting as the demo staff, so every rule, history entry, audit entry and
-- notification is produced exactly as in real use. After each step the
-- timestamps that step created are moved back to the date the story needs,
-- so the dashboard and reports show about seven months of activity.
--
-- AI analysis is not faked: every request starts with no analysis. After
-- Anthropic credit is added, run `npm run demo:analyse` to have Claude
-- analyse them for real.
--
-- Runs in one transaction. If anything fails, nothing is kept. Running it a
-- second time stops with "already seeded" and changes nothing.

begin;

-- Timestamps are set by this script; the automatic "updated now" triggers and
-- the append-only guards on history are paused for this transaction only.
alter table public.churches           disable trigger set_updated_at;
alter table public.church_memberships disable trigger set_updated_at;
alter table public.requests           disable trigger set_updated_at;
alter table public.resources          disable trigger set_updated_at;
alter table public.volunteers         disable trigger set_updated_at;
alter table public.assignments        disable trigger set_updated_at;
alter table public.request_events     disable trigger append_only;
alter table public.audit_logs         disable trigger append_only;

-- Act as a signed-in staff member (how auth.uid() sees the caller).
create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims',
                    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end,
                    true);
$$;

-- Move every timestamp created since the transaction began (that is, by the
-- step just taken) to p_at, keeping the few milliseconds between rows of the
-- same step so their order is preserved.
create function pg_temp.stamp(p_church uuid, p_at timestamptz) returns void language plpgsql as $$
declare t timestamptz := now();
begin
  update public.churches set created_at = least(created_at, p_at) where id = p_church and created_at >= t;
  update public.churches set updated_at = p_at + (updated_at - t) where id = p_church and updated_at >= t;
  update public.churches set verified_at = p_at + (verified_at - t) where id = p_church and verified_at >= t;
  update public.church_memberships set created_at = p_at + (created_at - t) where church_id = p_church and created_at >= t;
  update public.church_memberships set updated_at = p_at + (updated_at - t) where church_id = p_church and updated_at >= t;
  update public.requests set created_at = p_at + (created_at - t) where church_id = p_church and created_at >= t;
  update public.requests set consent_given_at = p_at + (consent_given_at - t) where church_id = p_church and consent_given_at >= t;
  update public.requests set updated_at = p_at + (updated_at - t) where church_id = p_church and updated_at >= t;
  update public.requests set attention_acknowledged_at = p_at + (attention_acknowledged_at - t) where church_id = p_church and attention_acknowledged_at >= t;
  update public.request_events set created_at = p_at + (created_at - t) where church_id = p_church and created_at >= t;
  update public.resources set created_at = p_at + (created_at - t) where church_id = p_church and created_at >= t;
  update public.resources set updated_at = p_at + (updated_at - t) where church_id = p_church and updated_at >= t;
  update public.allocations set created_at = p_at + (created_at - t) where church_id = p_church and created_at >= t;
  update public.allocations set approved_at = p_at + (approved_at - t) where church_id = p_church and approved_at >= t;
  update public.allocations set fulfilled_at = p_at + (fulfilled_at - t) where church_id = p_church and fulfilled_at >= t;
  update public.allocations set released_at = p_at + (released_at - t) where church_id = p_church and released_at >= t;
  update public.volunteers set created_at = p_at + (created_at - t) where church_id = p_church and created_at >= t;
  update public.volunteers set updated_at = p_at + (updated_at - t) where church_id = p_church and updated_at >= t;
  update public.volunteers set consent_given_at = p_at + (consent_given_at - t) where church_id = p_church and consent_given_at >= t;
  update public.assignments set created_at = p_at + (created_at - t) where church_id = p_church and created_at >= t;
  update public.assignments set updated_at = p_at + (updated_at - t) where church_id = p_church and updated_at >= t;
  update public.assignments set completed_at = p_at + (completed_at - t) where church_id = p_church and completed_at >= t;
  update public.notifications set created_at = p_at + (created_at - t) where church_id = p_church and created_at >= t;
  update public.audit_logs set created_at = p_at + (created_at - t) where church_id = p_church and created_at >= t;
end $$;

do $$
declare
  -- DEMO ACCOUNTS (create these first; see the top of this file)
  c_owner_email constant text := 'owner@hopeharvest.example';
  c_admin_email constant text := 'admin@hopeharvest.example';
  c_coord_email constant text := 'coordinator@hopeharvest.example';

  c_slug constant text := 'hope-harvest-chapel';
  v_now    timestamptz := now();
  v_owner  uuid; v_admin uuid; v_coord uuid;
  v_church uuid;
  v_res    jsonb := '{}';   -- resource key -> id
  v_vol    jsonb := '{}';   -- volunteer key -> id
  v_spec   jsonb; v_step jsonb;
  v_req    uuid; v_ref text; v_at timestamptz; v_created timestamptz;
  v_status text; v_actor uuid; v_task uuid; v_task_status text;
  v_item   jsonb; v_id uuid;
begin
  select id into v_owner from auth.users where lower(email) = c_owner_email;
  select id into v_admin from auth.users where lower(email) = c_admin_email;
  select id into v_coord from auth.users where lower(email) = c_coord_email;
  if v_owner is null or v_admin is null or v_coord is null then
    raise exception 'Create the three demo accounts first (Authentication -> Users -> Add user, Auto Confirm): %, %, %',
      c_owner_email, c_admin_email, c_coord_email;
  end if;
  if exists (select 1 from public.churches where slug = c_slug) then
    raise exception 'already seeded: % exists. Nothing changed.', c_slug;
  end if;
  if exists (select 1 from public.church_memberships where user_id in (v_owner, v_admin, v_coord)) then
    raise exception 'A demo account already belongs to a church. Use fresh demo accounts.';
  end if;

  -- The church, verified, with three staff -----------------------------------
  perform pg_temp.act(v_owner);
  v_church := public.create_church('Hope Harvest Chapel', c_slug, 'Akure');
  update public.churches
     set status = 'verified', verified_at = now(),
         contact_phone = '0800 000 0100',
         contact_email = 'care@hopeharvest.example',
         emergency_guidance = 'If someone is in immediate danger, call 112 now. For urgent medical help go to the nearest hospital emergency unit. Our care line is open Monday to Saturday, 9 am to 5 pm.'
   where id = v_church;
  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_church, null, 'church.status_changed', 'church', v_church,
          jsonb_build_object('from', 'pending', 'to', 'verified', 'note', 'demo setup'));
  insert into public.church_memberships (church_id, user_id, role, invited_by)
  values (v_church, v_admin, 'admin', v_owner), (v_church, v_coord, 'coordinator', v_owner);
  perform pg_temp.stamp(v_church, v_now - interval '230 days');

  -- Resources ---------------------------------------------------------------
  perform pg_temp.act(v_admin);
  for v_item in select * from jsonb_array_elements($j$[
    {"k":"food_pack","name":"Family food package","cat":"food","unit":"package","qty":60,"src":"church",
     "desc":"Rice, beans, garri, vegetable oil and tomato paste: about a week of meals for a family of four."},
    {"k":"rice","name":"Rice (10 kg bag)","cat":"food","unit":"bag","qty":30,"src":"partner","partner":"Ondo Harvest Food Bank",
     "desc":"Donated by our food bank partner each quarter."},
    {"k":"school_kit","name":"School supply kit","cat":"education","unit":"kit","qty":40,"src":"church",
     "desc":"Exercise books, pens, a mathematical set and a school bag."},
    {"k":"fare","name":"Transport fare support","cat":"transport","unit":"voucher","qty":25,"src":"church",
     "desc":"Covers a return trip within Ondo State for a hospital or job appointment."},
    {"k":"clothes","name":"Children's clothing bundle","cat":"clothing","unit":"bundle","qty":20,"src":"church",
     "desc":"Two outfits, sleepwear and sandals, sorted by age."},
    {"k":"baby","name":"Baby care pack","cat":"other","unit":"pack","qty":8,"src":"church",
     "desc":"Nappies, baby soap, wipes and a month of infant formula."},
    {"k":"hospital","name":"Hospital bill support","cat":"medical","unit":"payment","qty":10,"src":"partner","partner":"St. Luke Community Clinic",
     "desc":"Paid directly to the clinic, up to the agreed limit per family."},
    {"k":"rent","name":"Emergency rent support","cat":"accommodation","unit":"grant","qty":5,"src":"church",
     "areas":["Oke-Aro","Isikan","Arakale"],
     "desc":"One month of rent paid to the landlord. Available in the three areas our housing team covers."},
    {"k":"coaching","name":"CV and interview coaching","cat":"employment","unit":"session","qty":15,"src":"church",
     "desc":"One-to-one session with a volunteer from the careers ministry."}
  ]$j$::jsonb) loop
    v_id := public.save_resource(null, v_church, v_item->>'name', v_item->>'cat', v_item->>'desc',
              v_item->>'unit', (v_item->>'qty')::int, v_item->>'src', v_item->>'partner',
              coalesce(array(select jsonb_array_elements_text(v_item->'areas')), '{}'), null, null, null);
    v_res := v_res || jsonb_build_object(v_item->>'k', v_id);
  end loop;
  perform pg_temp.stamp(v_church, v_now - interval '220 days');

  -- Volunteers --------------------------------------------------------------
  perform pg_temp.act(v_coord);
  for v_item in select * from jsonb_array_elements($j$[
    {"k":"tunde","name":"Tunde Adeyemi","phone":"0800 000 0101","skills":["driving","deliveries"],"avail":"Weekday evenings and Saturdays","consent":true},
    {"k":"ngozi","name":"Ngozi Eze","phone":"0800 000 0102","skills":["home visits","prayer support"],"avail":"Tuesdays and Thursdays","consent":true},
    {"k":"kehinde","name":"Kehinde Bello","phone":null,"skills":["driving"],"avail":"Saturdays only","consent":false},
    {"k":"amaka","name":"Amaka Obi","phone":"0800 000 0104","skills":["tutoring","school liaison"],"avail":"After 4 pm on weekdays","consent":true},
    {"k":"samuel","name":"Samuel Ojo","phone":"0800 000 0105","skills":["nursing","first aid"],"avail":"Weekends","consent":true},
    {"k":"bisi","name":"Bisi Alade","phone":null,"skills":["packing"],"avail":"Away until January","consent":false,"status":"inactive"}
  ]$j$::jsonb) loop
    v_id := public.save_volunteer(null, v_church, v_item->>'name', v_item->>'phone',
              array(select jsonb_array_elements_text(v_item->'skills')), v_item->>'avail',
              (v_item->>'consent')::boolean, coalesce(v_item->>'status', 'active'));
    v_vol := v_vol || jsonb_build_object(v_item->>'k', v_id);
  end loop;
  perform pg_temp.stamp(v_church, v_now - interval '215 days');

  -- Requests and what happened to each ---------------------------------------
  -- d = days ago it arrived; each step happens h hours after arrival.
  -- by: o = owner, a = admin, c = coordinator (default).
  for v_spec in select * from jsonb_array_elements($j$[
    {"d":200,"ch":"public","cat":"food","q":1,"area":"Oda Road","cm":"phone_call","cv":"0800 000 2001",
     "text":"I lost my job at the sawmill last month and we have run out of food. There are five of us at home.",
     "steps":[{"h":3,"do":"review"},{"h":5,"do":"match"},{"h":20,"do":"approve","r":"food_pack","by":"a"},{"h":30,"do":"fulfil","note":"Collected at the church office."}]},
    {"d":150,"ch":"public","cat":"clothing","q":2,"area":"Isikan","cm":"none",
     "text":"My two boys have outgrown everything they own and the cold season is coming. Any clothes for ages 6 and 9 would help.",
     "steps":[{"h":4,"do":"review"},{"h":6,"do":"match"},{"h":26,"do":"approve","r":"clothes","by":"a"},{"h":50,"do":"fulfil"}]},
    {"d":88,"ch":"public","cat":"transport","q":1,"area":"Shagari Village","cm":"sms","cv":"0800 000 2003",
     "text":"Please I need transport money to travel to Lagos for a family event.",
     "steps":[{"h":5,"do":"review"},{"h":8,"do":"decline","note":"Outside what our transport support covers (medical and job appointments within Ondo State). Explained by SMS."}]},
    {"d":75,"ch":"staff","cat":"food","q":1,"area":"Arakale","name":"Mama Ronke","cm":"in_person",
     "text":"Elderly widow living alone, met during the Tuesday visit. Cupboards nearly empty; her son sends money irregularly.",
     "steps":[{"h":1,"do":"review"},{"h":2,"do":"match"},{"h":4,"do":"approve","r":"food_pack","by":"a"},{"h":24,"do":"progress"},
              {"h":25,"do":"assign","v":"tunde","brief":"Deliver one family food package to Arakale. Call before arriving."},{"h":30,"do":"task","to":"completed"},{"h":31,"do":"fulfil","note":"Delivered by Tunde."}]},
    {"d":58,"ch":"staff","cat":"food","q":1,"area":"Alagbaka","name":"Mrs Funmi","cm":"phone_call","cv":"0800 000 2005",
     "text":"Widow with three children. Lost her market stall income during the heavy rains and has not been able to restock.",
     "steps":[{"h":2,"do":"review"},{"h":4,"do":"match"},{"h":24,"do":"approve","r":"food_pack","by":"a"},{"h":30,"do":"progress"},
              {"h":31,"do":"assign","v":"tunde","brief":"Deliver one family food package to Alagbaka."},{"h":48,"do":"task","to":"completed"},{"h":50,"do":"fulfil","note":"Delivered. Family also invited to the Thursday fellowship lunch."}]},
    {"d":45,"ch":"public","cat":"education","q":2,"area":"Oba-Ile","cm":"phone_call","cv":"0800 000 2006",
     "text":"My two children start the new term next week and they have no exercise books or school bags.",
     "steps":[{"h":3,"do":"review"},{"h":5,"do":"match"},{"h":20,"do":"approve","r":"school_kit","by":"a"},{"h":44,"do":"fulfil","note":"Parent collected two kits."}]},
    {"d":40,"ch":"public","cat":"medical","q":1,"area":"Ijapo Estate","cm":"phone_call","cv":"0800 000 2007",
     "text":"My father needs a scan the hospital asked for and we cannot pay for it before his next appointment.",
     "steps":[{"h":4,"do":"review"},{"h":6,"do":"clarify","note":"Asked for the clinic's written estimate and the appointment date."},
              {"h":52,"do":"review","note":"Estimate received: within the hospital support limit."},{"h":54,"do":"match"},
              {"h":72,"do":"approve","r":"hospital","by":"o"},{"h":96,"do":"progress"},{"h":120,"do":"fulfil","note":"Paid directly to St. Luke Community Clinic."}]},
    {"d":33,"ch":"staff","cat":"transport","q":2,"area":"Shagari Village","name":"Brother Femi","cm":"phone_call","cv":"0800 000 2008",
     "text":"Needs return fare for himself and his son to the eye clinic in Ondo town on Friday.",
     "steps":[{"h":1,"do":"review"},{"h":2,"do":"match"},{"h":5,"do":"approve","r":"fare","by":"a"},{"h":70,"do":"fulfil"}]},
    {"d":29,"ch":"public","cat":"food","q":1,"area":"Isikan","cm":"none",
     "text":"We are a family of six. My husband's salary has not been paid for three months.",
     "steps":[{"h":2,"do":"review"},{"h":3,"do":"match"},{"h":22,"do":"approve","r":"rice","by":"a"},{"h":26,"do":"progress"},
              {"h":27,"do":"assign","v":"kehinde","brief":"Deliver one 10 kg bag of rice to Isikan on Saturday."},{"h":70,"do":"task","to":"completed"},{"h":72,"do":"fulfil"}]},
    {"d":27,"ch":"public","cat":"clothing","q":3,"area":"Oke-Aro","cm":"phone_call","cv":"0800 000 2010",
     "text":"There was a fire in our compound on Sunday. My three children lost all their clothes. We are staying with a neighbour.",
     "steps":[{"h":1,"do":"review"},{"h":2,"do":"match"},{"h":5,"do":"approve","r":"clothes","by":"o"},{"h":6,"do":"progress"},
              {"h":7,"do":"assign","v":"ngozi","brief":"Take three clothing bundles to Oke-Aro and pray with the family."},
              {"h":8,"do":"task","to":"in_progress"},{"h":28,"do":"task","to":"completed"},{"h":30,"do":"fulfil","note":"Delivered by Ngozi. Follow-up visit planned."}]},
    {"d":25,"ch":"public","cat":"accommodation","q":1,"area":"Arakale","cm":"phone_call","cv":"0800 000 2011",
     "text":"My sister and her two children are not safe at home and need somewhere to stay for a few nights.",
     "steps":[{"h":1,"do":"ack","by":"o","note":"Called within the hour. Pastoral care lead arranged a safe place with church family; referral made."},
              {"h":2,"do":"review"},{"h":30,"do":"unable","note":"Not a rent need. Referred to a women's shelter partner; pastoral care continues to follow up."}]},
    {"d":22,"ch":"public","cat":"financial","q":1,"area":"Oda Road","cm":"sms","cv":"0800 000 2012",
     "text":"I need money to buy fuel for my generator for the shop.",
     "steps":[{"h":3,"do":"review"},{"h":5,"do":"decline","note":"Business costs are outside the benevolence fund. Offered CV coaching and food support instead."}]},
    {"d":20,"ch":"staff","cat":"other","q":2,"area":"Alagbaka","name":"Sister Joy","cm":"phone_call","cv":"0800 000 2013",
     "text":"New mother of twins, discharged from hospital last week. Needs nappies and formula.",
     "steps":[{"h":1,"do":"review"},{"h":2,"do":"match"},{"h":3,"do":"approve","r":"baby","by":"a"},{"h":4,"do":"progress"},
              {"h":5,"do":"assign","v":"samuel","brief":"Deliver two baby care packs to Alagbaka and check on mother and babies."},
              {"h":26,"do":"task","to":"completed"},{"h":27,"do":"fulfil","note":"Delivered. Mother and twins doing well."}]},
    {"d":18,"ch":"public","cat":"food","q":1,"area":"Iju Road","cm":"none",
     "text":"We need food for this week, things are hard since my husband travelled.",
     "steps":[{"h":4,"do":"review"},{"h":30,"do":"cancel","note":"The family told us a relative is now helping."}]},
    {"d":16,"ch":"public","cat":"employment","q":1,"area":"FUTA South Gate","cm":"phone_call","cv":"0800 000 2015",
     "text":"I graduated last year and I have two job interviews coming up. I would like help with my CV and practising interviews.",
     "steps":[{"h":3,"do":"review"},{"h":4,"do":"match"},{"h":20,"do":"approve","r":"coaching","by":"a"},{"h":96,"do":"fulfil","note":"Two coaching sessions held."}]},
    {"d":14,"ch":"public","cat":"other","q":2,"area":"Ilesa Garage","cm":"phone_call","cv":"0800 000 2016",
     "text":"I have a three-month-old baby and a toddler. We have run out of nappies and formula.",
     "steps":[{"h":2,"do":"review"},{"h":3,"do":"match"},{"h":20,"do":"approve","r":"baby","by":"a"},{"h":46,"do":"fulfil"}]},
    {"d":12,"ch":"public","cat":"education","q":1,"area":"Isikan","cm":"phone_call","cv":"0800 000 2017",
     "text":"My daughter is in JSS 2 and has been sent home for not having the required textbooks and writing materials.",
     "steps":[{"h":2,"do":"review"},{"h":3,"do":"match"},{"h":6,"do":"approve","r":"school_kit","by":"a"},{"h":8,"do":"progress"},
              {"h":9,"do":"assign","v":"amaka","brief":"Bring one school supply kit to Isikan and speak with the school if needed."},
              {"h":50,"do":"task","to":"completed"},{"h":52,"do":"fulfil"}]},
    {"d":10,"ch":"staff","cat":"food","q":1,"area":"Oke-Aro","name":"Baba Sola","cm":"in_person",
     "text":"Elderly man, recently bereaved, eating one meal a day. Neighbours alerted the house fellowship leader.",
     "steps":[{"h":1,"do":"review"},{"h":2,"do":"match"},{"h":3,"do":"approve","r":"food_pack","by":"o"},{"h":4,"do":"progress"},
              {"h":5,"do":"assign","v":"tunde","brief":"Deliver one family food package to Oke-Aro. Sit with him for a while if he wants company."},
              {"h":98,"do":"task","to":"completed"},{"h":100,"do":"fulfil","note":"Delivered. House fellowship will visit weekly."},
              {"h":101,"do":"note","note":"Added to the weekly visiting list."}]},
    {"d":8,"ch":"public","cat":"other","q":2,"area":"Shagari Village","cm":"phone_call","cv":"0800 000 2019",
     "text":"Single mother with a newborn and a one-year-old. I cannot afford nappies or formula this month.",
     "steps":[{"h":2,"do":"review"},{"h":3,"do":"match"},{"h":6,"do":"approve","r":"baby","by":"a"},{"h":20,"do":"progress"},
              {"h":21,"do":"assign","v":"ngozi","brief":"Deliver two baby care packs to Shagari Village."},{"h":22,"do":"task","to":"in_progress"}]},
    {"d":7,"ch":"public","cat":"medical","q":1,"area":"Arakale","cm":"phone_call","cv":"0800 000 2020",
     "text":"My mother's blood pressure medicine has run out and the clinic will not refill it until we clear what we owe.",
     "steps":[{"h":3,"do":"review"},{"h":5,"do":"match"},{"h":30,"do":"approve","r":"hospital","by":"o","note":"Payment to the clinic agreed for this week."}]},
    {"d":6,"ch":"public","cat":"transport","q":1,"area":"Oba-Ile","cm":"sms","cv":"0800 000 2021",
     "text":"I need transport fare for a hospital appointment.",
     "steps":[{"h":4,"do":"review"},{"h":6,"do":"clarify","note":"Asked which hospital and the date of the appointment."}]},
    {"d":5,"ch":"public","cat":"food","q":1,"area":"Ijapo Estate","cm":"phone_call","cv":"0800 000 2022",
     "text":"I am a student nurse and my allowance is late. I have no food left for the rest of the month.",
     "steps":[{"h":3,"do":"review"},{"h":5,"do":"match"}]},
    {"d":4,"ch":"public","cat":"accommodation","q":1,"area":"Ilesa Garage","cm":"phone_call","cv":"0800 000 2023",
     "text":"Our landlord has given us two weeks to pay three months of rent or leave.",
     "steps":[{"h":3,"do":"review"},{"h":5,"do":"match","note":"Rent support does not cover Ilesa Garage. Looking for another option."}]},
    {"d":3,"ch":"public","cat":"clothing","q":2,"area":"Iju Road","cm":"none",
     "text":"My children need school sandals and clothes. Ages 5 and 7.",
     "steps":[{"h":5,"do":"review"}]},
    {"d":2,"ch":"public","cat":"other","q":1,"area":"Alagbaka","cm":"phone_call","cv":"0800 000 2025",
     "text":"A teenage girl from next door says she is not safe at home and has been sleeping at our place. She needs food and some school things.",
     "steps":[]},
    {"d":1,"ch":"public","cat":"education","q":1,"area":"Oda Road","cm":"phone_call","cv":"0800 000 2026",
     "text":"My son passed his entrance exam but we cannot afford the books on the school list.",
     "steps":[]},
    {"d":0.25,"ch":"public","cat":"food","q":2,"area":"Oke-Aro","cm":"phone_call","cv":"0800 000 2027",
     "text":"Two families sharing one flat after flooding. We need food for about ten people this week.",
     "steps":[]},
    {"d":0.08,"ch":"staff","cat":"employment","q":1,"area":"Isikan","name":"Brother Dayo","cm":"in_person",
     "text":"Came to the Sunday welcome desk. Lost his job as a security guard and asked for help finding work.",
     "steps":[]}
  ]$j$::jsonb) loop
    v_created := v_now - make_interval(secs => (v_spec->>'d')::numeric * 86400);
    if v_spec->>'ch' = 'public' then
      perform pg_temp.act(null);
      select reference into v_ref from public.submit_public_request(
        c_slug, md5(random()::text), v_spec->>'cat', v_spec->>'text', (v_spec->>'q')::int,
        v_spec->>'name', v_spec->>'cm', v_spec->>'cv', v_spec->>'area');
      select id into v_req from public.requests where reference = v_ref;
    else
      perform pg_temp.act(v_coord);
      select id into v_req from public.staff_submit_request(
        v_church, v_spec->>'cat', v_spec->>'text', (v_spec->>'q')::int,
        v_spec->>'name', v_spec->>'cm', v_spec->>'cv', v_spec->>'area');
    end if;
    perform pg_temp.stamp(v_church, v_created);

    v_task := null;
    for v_step in select * from jsonb_array_elements(v_spec->'steps') loop
      v_actor := case v_step->>'by' when 'o' then v_owner when 'a' then v_admin else v_coord end;
      perform pg_temp.act(v_actor);
      select status into v_status from public.requests where id = v_req;
      case v_step->>'do'
        when 'review'   then perform public.change_request_status(v_req, v_status, 'under_review', v_step->>'note');
        when 'clarify'  then perform public.change_request_status(v_req, v_status, 'awaiting_clarification', v_step->>'note');
        when 'match'    then perform public.change_request_status(v_req, v_status, 'awaiting_match', v_step->>'note');
        when 'progress' then perform public.change_request_status(v_req, v_status, 'in_progress', v_step->>'note');
        when 'decline'  then perform public.change_request_status(v_req, v_status, 'declined', v_step->>'note');
        when 'cancel'   then perform public.change_request_status(v_req, v_status, 'cancelled', v_step->>'note');
        when 'unable'   then perform public.change_request_status(v_req, v_status, 'unable_to_fulfil', v_step->>'note');
        when 'approve'  then perform public.approve_allocation(v_req, v_status, (v_res->>(v_step->>'r'))::uuid, v_step->>'note');
        when 'fulfil'   then perform public.record_fulfilment(v_req, v_status, v_step->>'note');
        when 'note'     then perform public.add_request_note(v_req, v_step->>'note');
        when 'ack'      then perform public.acknowledge_request_attention(v_req, v_step->>'note');
        when 'assign'   then
          v_task := public.create_assignment(v_req, v_status, (v_vol->>(v_step->>'v'))::uuid, v_step->>'brief');
        when 'task'     then
          select status into v_task_status from public.assignments where id = v_task;
          perform public.update_assignment_status(v_task, v_task_status, v_step->>'to');
        else raise exception 'unknown demo step %', v_step->>'do';
      end case;
      v_at := v_created + make_interval(hours => (v_step->>'h')::int);
      if v_at > v_now then
        raise exception 'demo step % for % would be in the future', v_step->>'do', v_spec->>'text';
      end if;
      perform pg_temp.stamp(v_church, v_at);
    end loop;
  end loop;

  -- The seed's own intake counters are not real traffic.
  delete from public.intake_rate_limits where church_id = v_church;

  -- Staff have read everything older than three days.
  update public.notifications set read_at = created_at + interval '2 hours'
   where church_id = v_church and created_at < v_now - interval '3 days';

  perform pg_temp.act(null);
  raise notice 'Demo church created: Hope Harvest Chapel (/request/%)', c_slug;
end $$;

alter table public.churches           enable trigger set_updated_at;
alter table public.church_memberships enable trigger set_updated_at;
alter table public.requests           enable trigger set_updated_at;
alter table public.resources          enable trigger set_updated_at;
alter table public.volunteers         enable trigger set_updated_at;
alter table public.assignments        enable trigger set_updated_at;
alter table public.request_events     enable trigger append_only;
alter table public.audit_logs         enable trigger append_only;

commit;

-- Check
select r.status, count(*)::int as requests
  from public.requests r join public.churches c on c.id = r.church_id
 where c.slug = 'hope-harvest-chapel'
 group by r.status order by r.status;
