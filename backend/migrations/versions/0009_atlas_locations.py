"""Persist Atlas bookmarks and the current parking spot."""
from alembic import op
import sqlalchemy as sa

revision = "0009_atlas_locations"
down_revision = "0008_backfill_existing_consent"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "atlas_locations",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("data", sa.JSON(), nullable=False),
    )


def downgrade():
    raise RuntimeError("Restore a verified backup to downgrade")
