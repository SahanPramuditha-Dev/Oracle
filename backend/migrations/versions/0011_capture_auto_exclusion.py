"""Keep manually unlinked captures out of automatic assignment."""
from alembic import op
import sqlalchemy as sa

revision = '0011_capture_auto_exclusion'
down_revision = '0010_capture_folders'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('memories', sa.Column('capture_auto_excluded', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column('memories', 'capture_auto_excluded')
