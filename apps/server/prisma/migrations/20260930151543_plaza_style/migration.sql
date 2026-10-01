-- CreateEnum
CREATE TYPE "PlazaStyle" AS ENUM ('TOP_DOWN', 'SIDE_SCROLL');

-- AlterTable
ALTER TABLE "communities" ADD COLUMN     "plaza_style" "PlazaStyle" NOT NULL DEFAULT 'TOP_DOWN';
