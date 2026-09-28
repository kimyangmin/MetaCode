-- CreateTable
CREATE TABLE "community_maps" (
    "community_id" UUID NOT NULL,
    "definition" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_maps_pkey" PRIMARY KEY ("community_id")
);

-- AddForeignKey
ALTER TABLE "community_maps" ADD CONSTRAINT "community_maps_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
