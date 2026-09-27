-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "private" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_roles" (
    "community_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "member_roles_pkey" PRIMARY KEY ("role_id","user_id")
);

-- CreateTable
CREATE TABLE "channel_role_access" (
    "channel_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "channel_role_access_pkey" PRIMARY KEY ("channel_id","role_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_community_id_name_key" ON "roles"("community_id", "name");

-- CreateIndex
CREATE INDEX "member_roles_community_id_user_id_idx" ON "member_roles"("community_id", "user_id");

-- CreateIndex
CREATE INDEX "channel_role_access_role_id_idx" ON "channel_role_access"("role_id");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_community_id_user_id_fkey" FOREIGN KEY ("community_id", "user_id") REFERENCES "community_members"("community_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_role_access" ADD CONSTRAINT "channel_role_access_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_role_access" ADD CONSTRAINT "channel_role_access_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
