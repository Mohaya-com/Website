ALTER TABLE "arrival_registrations" ALTER COLUMN "full_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "arrival_registrations" ALTER COLUMN "nationality" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "arrival_registrations" ALTER COLUMN "document_expiry_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "arrival_registrations" ALTER COLUMN "document_expiry_calendar" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "arrival_registrations" ALTER COLUMN "document_expiry_original" DROP NOT NULL;