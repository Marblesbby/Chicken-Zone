drop extension if exists "pg_net";


  create table "public"."maintenance_reminders" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "vehicle_id" uuid,
    "title" text not null,
    "description" text,
    "reminder_type" text,
    "interval_miles" integer,
    "interval_days" integer,
    "last_done_mileage" integer,
    "last_done_date" date,
    "next_due_mileage" integer,
    "next_due_date" date,
    "snoozed_until_mileage" integer,
    "snoozed_until_date" date,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."maintenance_reminders" enable row level security;


  create table "public"."mileage_logs" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "vehicle_id" uuid,
    "mileage" integer not null,
    "logged_at" timestamp with time zone default now(),
    "notes" text
      );


alter table "public"."mileage_logs" enable row level security;


  create table "public"."part_installations" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "part_id" uuid,
    "vehicle_id" uuid,
    "installed_date" date,
    "installed_mileage" integer,
    "removed_date" date,
    "removal_reason" text,
    "notes" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."part_installations" enable row level security;


  create table "public"."parts" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "created_by" uuid,
    "name" text not null,
    "part_number" text,
    "oem_part_number" text,
    "catalog_part_id" text,
    "failure_frequency_rank" integer default 999,
    "condition" text,
    "quantity" integer default 1,
    "source" text,
    "date_acquired" date,
    "shelf_location" text,
    "scanned_to_location_at" timestamp with time zone,
    "compatible_vehicles" text,
    "sourced_from_vehicle" text,
    "notes" text,
    "receipt_url" text,
    "image_url" text,
    "shop_url" text,
    "price_paid" numeric(10,2),
    "low_stock_threshold" integer default 1,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."parts" enable row level security;


  create table "public"."profiles" (
    "id" uuid not null,
    "full_name" text,
    "role" text default 'viewer'::text,
    "created_at" timestamp with time zone default now(),
    "username" text,
    "real_email" text
      );


alter table "public"."profiles" enable row level security;


  create table "public"."service_history" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "vehicle_id" uuid,
    "service_type" text,
    "description" text,
    "performed_date" date,
    "mileage_at_service" integer,
    "performed_by" text,
    "notes" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."service_history" enable row level security;


  create table "public"."vehicles" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "created_by" uuid,
    "year" integer,
    "make" text,
    "model" text,
    "trim" text,
    "color" text,
    "vin" text,
    "current_mileage" integer default 0,
    "notes" text,
    "image_url" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."vehicles" enable row level security;


  create table "public"."wishlist" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "created_by" uuid,
    "name" text not null,
    "part_number" text,
    "compatible_vehicles" text,
    "notes" text,
    "priority" text default 'Medium'::text,
    "found" boolean default false,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."wishlist" enable row level security;

CREATE UNIQUE INDEX maintenance_reminders_pkey ON public.maintenance_reminders USING btree (id);

CREATE UNIQUE INDEX mileage_logs_pkey ON public.mileage_logs USING btree (id);

CREATE UNIQUE INDEX part_installations_pkey ON public.part_installations USING btree (id);

CREATE UNIQUE INDEX parts_pkey ON public.parts USING btree (id);

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);

CREATE UNIQUE INDEX profiles_username_key ON public.profiles USING btree (username);

CREATE UNIQUE INDEX service_history_pkey ON public.service_history USING btree (id);

CREATE UNIQUE INDEX vehicles_pkey ON public.vehicles USING btree (id);

CREATE UNIQUE INDEX wishlist_pkey ON public.wishlist USING btree (id);

alter table "public"."maintenance_reminders" add constraint "maintenance_reminders_pkey" PRIMARY KEY using index "maintenance_reminders_pkey";

alter table "public"."mileage_logs" add constraint "mileage_logs_pkey" PRIMARY KEY using index "mileage_logs_pkey";

alter table "public"."part_installations" add constraint "part_installations_pkey" PRIMARY KEY using index "part_installations_pkey";

alter table "public"."parts" add constraint "parts_pkey" PRIMARY KEY using index "parts_pkey";

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."service_history" add constraint "service_history_pkey" PRIMARY KEY using index "service_history_pkey";

alter table "public"."vehicles" add constraint "vehicles_pkey" PRIMARY KEY using index "vehicles_pkey";

alter table "public"."wishlist" add constraint "wishlist_pkey" PRIMARY KEY using index "wishlist_pkey";

alter table "public"."maintenance_reminders" add constraint "maintenance_reminders_reminder_type_check" CHECK ((reminder_type = ANY (ARRAY['mileage'::text, 'time'::text, 'both'::text]))) not valid;

alter table "public"."maintenance_reminders" validate constraint "maintenance_reminders_reminder_type_check";

alter table "public"."maintenance_reminders" add constraint "maintenance_reminders_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE not valid;

alter table "public"."maintenance_reminders" validate constraint "maintenance_reminders_vehicle_id_fkey";

alter table "public"."mileage_logs" add constraint "mileage_logs_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE not valid;

alter table "public"."mileage_logs" validate constraint "mileage_logs_vehicle_id_fkey";

alter table "public"."part_installations" add constraint "part_installations_part_id_fkey" FOREIGN KEY (part_id) REFERENCES public.parts(id) ON DELETE SET NULL not valid;

alter table "public"."part_installations" validate constraint "part_installations_part_id_fkey";

alter table "public"."part_installations" add constraint "part_installations_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE not valid;

alter table "public"."part_installations" validate constraint "part_installations_vehicle_id_fkey";

alter table "public"."parts" add constraint "parts_condition_check" CHECK ((condition = ANY (ARRAY['New'::text, 'Used - Good'::text, 'Used - Fair'::text, 'Used - Poor'::text]))) not valid;

alter table "public"."parts" validate constraint "parts_condition_check";

alter table "public"."parts" add constraint "parts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) not valid;

alter table "public"."parts" validate constraint "parts_created_by_fkey";

alter table "public"."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."profiles" validate constraint "profiles_id_fkey";

alter table "public"."profiles" add constraint "profiles_username_key" UNIQUE using index "profiles_username_key";

alter table "public"."service_history" add constraint "service_history_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE not valid;

alter table "public"."service_history" validate constraint "service_history_vehicle_id_fkey";

alter table "public"."vehicles" add constraint "vehicles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) not valid;

alter table "public"."vehicles" validate constraint "vehicles_created_by_fkey";

alter table "public"."wishlist" add constraint "wishlist_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) not valid;

alter table "public"."wishlist" validate constraint "wishlist_created_by_fkey";

alter table "public"."wishlist" add constraint "wishlist_priority_check" CHECK ((priority = ANY (ARRAY['Low'::text, 'Medium'::text, 'High'::text]))) not valid;

alter table "public"."wishlist" validate constraint "wishlist_priority_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$function$
;

grant delete on table "public"."maintenance_reminders" to "anon";

grant insert on table "public"."maintenance_reminders" to "anon";

grant references on table "public"."maintenance_reminders" to "anon";

grant select on table "public"."maintenance_reminders" to "anon";

grant trigger on table "public"."maintenance_reminders" to "anon";

grant truncate on table "public"."maintenance_reminders" to "anon";

grant update on table "public"."maintenance_reminders" to "anon";

grant delete on table "public"."maintenance_reminders" to "authenticated";

grant insert on table "public"."maintenance_reminders" to "authenticated";

grant references on table "public"."maintenance_reminders" to "authenticated";

grant select on table "public"."maintenance_reminders" to "authenticated";

grant trigger on table "public"."maintenance_reminders" to "authenticated";

grant truncate on table "public"."maintenance_reminders" to "authenticated";

grant update on table "public"."maintenance_reminders" to "authenticated";

grant delete on table "public"."maintenance_reminders" to "service_role";

grant insert on table "public"."maintenance_reminders" to "service_role";

grant references on table "public"."maintenance_reminders" to "service_role";

grant select on table "public"."maintenance_reminders" to "service_role";

grant trigger on table "public"."maintenance_reminders" to "service_role";

grant truncate on table "public"."maintenance_reminders" to "service_role";

grant update on table "public"."maintenance_reminders" to "service_role";

grant delete on table "public"."mileage_logs" to "anon";

grant insert on table "public"."mileage_logs" to "anon";

grant references on table "public"."mileage_logs" to "anon";

grant select on table "public"."mileage_logs" to "anon";

grant trigger on table "public"."mileage_logs" to "anon";

grant truncate on table "public"."mileage_logs" to "anon";

grant update on table "public"."mileage_logs" to "anon";

grant delete on table "public"."mileage_logs" to "authenticated";

grant insert on table "public"."mileage_logs" to "authenticated";

grant references on table "public"."mileage_logs" to "authenticated";

grant select on table "public"."mileage_logs" to "authenticated";

grant trigger on table "public"."mileage_logs" to "authenticated";

grant truncate on table "public"."mileage_logs" to "authenticated";

grant update on table "public"."mileage_logs" to "authenticated";

grant delete on table "public"."mileage_logs" to "service_role";

grant insert on table "public"."mileage_logs" to "service_role";

grant references on table "public"."mileage_logs" to "service_role";

grant select on table "public"."mileage_logs" to "service_role";

grant trigger on table "public"."mileage_logs" to "service_role";

grant truncate on table "public"."mileage_logs" to "service_role";

grant update on table "public"."mileage_logs" to "service_role";

grant delete on table "public"."part_installations" to "anon";

grant insert on table "public"."part_installations" to "anon";

grant references on table "public"."part_installations" to "anon";

grant select on table "public"."part_installations" to "anon";

grant trigger on table "public"."part_installations" to "anon";

grant truncate on table "public"."part_installations" to "anon";

grant update on table "public"."part_installations" to "anon";

grant delete on table "public"."part_installations" to "authenticated";

grant insert on table "public"."part_installations" to "authenticated";

grant references on table "public"."part_installations" to "authenticated";

grant select on table "public"."part_installations" to "authenticated";

grant trigger on table "public"."part_installations" to "authenticated";

grant truncate on table "public"."part_installations" to "authenticated";

grant update on table "public"."part_installations" to "authenticated";

grant delete on table "public"."part_installations" to "service_role";

grant insert on table "public"."part_installations" to "service_role";

grant references on table "public"."part_installations" to "service_role";

grant select on table "public"."part_installations" to "service_role";

grant trigger on table "public"."part_installations" to "service_role";

grant truncate on table "public"."part_installations" to "service_role";

grant update on table "public"."part_installations" to "service_role";

grant delete on table "public"."parts" to "anon";

grant insert on table "public"."parts" to "anon";

grant references on table "public"."parts" to "anon";

grant select on table "public"."parts" to "anon";

grant trigger on table "public"."parts" to "anon";

grant truncate on table "public"."parts" to "anon";

grant update on table "public"."parts" to "anon";

grant delete on table "public"."parts" to "authenticated";

grant insert on table "public"."parts" to "authenticated";

grant references on table "public"."parts" to "authenticated";

grant select on table "public"."parts" to "authenticated";

grant trigger on table "public"."parts" to "authenticated";

grant truncate on table "public"."parts" to "authenticated";

grant update on table "public"."parts" to "authenticated";

grant delete on table "public"."parts" to "service_role";

grant insert on table "public"."parts" to "service_role";

grant references on table "public"."parts" to "service_role";

grant select on table "public"."parts" to "service_role";

grant trigger on table "public"."parts" to "service_role";

grant truncate on table "public"."parts" to "service_role";

grant update on table "public"."parts" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant delete on table "public"."service_history" to "anon";

grant insert on table "public"."service_history" to "anon";

grant references on table "public"."service_history" to "anon";

grant select on table "public"."service_history" to "anon";

grant trigger on table "public"."service_history" to "anon";

grant truncate on table "public"."service_history" to "anon";

grant update on table "public"."service_history" to "anon";

grant delete on table "public"."service_history" to "authenticated";

grant insert on table "public"."service_history" to "authenticated";

grant references on table "public"."service_history" to "authenticated";

grant select on table "public"."service_history" to "authenticated";

grant trigger on table "public"."service_history" to "authenticated";

grant truncate on table "public"."service_history" to "authenticated";

grant update on table "public"."service_history" to "authenticated";

grant delete on table "public"."service_history" to "service_role";

grant insert on table "public"."service_history" to "service_role";

grant references on table "public"."service_history" to "service_role";

grant select on table "public"."service_history" to "service_role";

grant trigger on table "public"."service_history" to "service_role";

grant truncate on table "public"."service_history" to "service_role";

grant update on table "public"."service_history" to "service_role";

grant delete on table "public"."vehicles" to "anon";

grant insert on table "public"."vehicles" to "anon";

grant references on table "public"."vehicles" to "anon";

grant select on table "public"."vehicles" to "anon";

grant trigger on table "public"."vehicles" to "anon";

grant truncate on table "public"."vehicles" to "anon";

grant update on table "public"."vehicles" to "anon";

grant delete on table "public"."vehicles" to "authenticated";

grant insert on table "public"."vehicles" to "authenticated";

grant references on table "public"."vehicles" to "authenticated";

grant select on table "public"."vehicles" to "authenticated";

grant trigger on table "public"."vehicles" to "authenticated";

grant truncate on table "public"."vehicles" to "authenticated";

grant update on table "public"."vehicles" to "authenticated";

grant delete on table "public"."vehicles" to "service_role";

grant insert on table "public"."vehicles" to "service_role";

grant references on table "public"."vehicles" to "service_role";

grant select on table "public"."vehicles" to "service_role";

grant trigger on table "public"."vehicles" to "service_role";

grant truncate on table "public"."vehicles" to "service_role";

grant update on table "public"."vehicles" to "service_role";

grant delete on table "public"."wishlist" to "anon";

grant insert on table "public"."wishlist" to "anon";

grant references on table "public"."wishlist" to "anon";

grant select on table "public"."wishlist" to "anon";

grant trigger on table "public"."wishlist" to "anon";

grant truncate on table "public"."wishlist" to "anon";

grant update on table "public"."wishlist" to "anon";

grant delete on table "public"."wishlist" to "authenticated";

grant insert on table "public"."wishlist" to "authenticated";

grant references on table "public"."wishlist" to "authenticated";

grant select on table "public"."wishlist" to "authenticated";

grant trigger on table "public"."wishlist" to "authenticated";

grant truncate on table "public"."wishlist" to "authenticated";

grant update on table "public"."wishlist" to "authenticated";

grant delete on table "public"."wishlist" to "service_role";

grant insert on table "public"."wishlist" to "service_role";

grant references on table "public"."wishlist" to "service_role";

grant select on table "public"."wishlist" to "service_role";

grant trigger on table "public"."wishlist" to "service_role";

grant truncate on table "public"."wishlist" to "service_role";

grant update on table "public"."wishlist" to "service_role";


  create policy "Auth users all access"
  on "public"."maintenance_reminders"
  as permissive
  for all
  to public
using ((auth.role() = 'authenticated'::text));



  create policy "Auth users all access"
  on "public"."mileage_logs"
  as permissive
  for all
  to public
using ((auth.role() = 'authenticated'::text));



  create policy "Auth users all access"
  on "public"."part_installations"
  as permissive
  for all
  to public
using ((auth.role() = 'authenticated'::text));



  create policy "Auth users all access"
  on "public"."parts"
  as permissive
  for all
  to public
using ((auth.role() = 'authenticated'::text));



  create policy "Auth users all access"
  on "public"."profiles"
  as permissive
  for all
  to public
using ((auth.role() = 'authenticated'::text));



  create policy "Auth users all access"
  on "public"."service_history"
  as permissive
  for all
  to public
using ((auth.role() = 'authenticated'::text));



  create policy "Auth users all access"
  on "public"."vehicles"
  as permissive
  for all
  to public
using ((auth.role() = 'authenticated'::text));



  create policy "Auth users all access"
  on "public"."wishlist"
  as permissive
  for all
  to public
using ((auth.role() = 'authenticated'::text));


CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


