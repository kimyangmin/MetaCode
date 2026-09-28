-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('TILE', 'OBJECT', 'CHARACTER');

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "creator_id" UUID NOT NULL,
    "community_id" UUID,
    "manifest" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_creator_id_kind_idx" ON "assets"("creator_id", "kind");

-- CreateIndex
CREATE INDEX "assets_community_id_idx" ON "assets"("community_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
