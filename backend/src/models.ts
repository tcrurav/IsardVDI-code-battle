import { DataTypes, Model, Sequelize, type ModelStatic } from 'sequelize';

export class Participant extends Model {
  declare id: number;
  declare name: string;
  declare token_hash: string | null;
  declare created_at: Date;
}
export class Challenge extends Model {
  declare id: number;
  declare position: number;
  declare title: string;
  declare description: string;
  declare public_files: Record<string, string>;
}
export class Progress extends Model {
  declare id: number;
  declare participant_id: number;
  declare challenge_id: number;
  declare completed: boolean;
  declare score: number;
  declare completed_at: Date | null;
}
export class CompetitionState extends Model {
  declare id: number;
  declare current_challenge: number;
  declare individual_progress_enabled: boolean;
  declare paused: boolean;
}
export class Submission extends Model {
  declare id: number;
  declare participant_id: number;
  declare challenge_id: number;
  declare status: 'pending' | 'accepted' | 'rejected';
  declare feedback: string | null;
  declare files: Record<string, string>;
  declare created_at: Date;
}
export interface Models {
  Participant: ModelStatic<Participant>;
  Challenge: ModelStatic<Challenge>;
  Progress: ModelStatic<Progress>;
  CompetitionState: ModelStatic<CompetitionState>;
  Submission: ModelStatic<Submission>;
}
export function defineModels(sequelize: Sequelize): Models {
  // Per-connection subclasses keep independently created apps/tests isolated.
  class P extends Participant {}
  class C extends Challenge {}
  class R extends Progress {}
  class S extends CompetitionState {}
  class U extends Submission {}
  const id = { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true };
  const options = (tableName: string) => ({ sequelize, tableName, timestamps: false });
  P.init(
    {
      id,
      name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      token_hash: { type: DataTypes.STRING(64), allowNull: true, unique: true },
      created_at: { type: DataTypes.DATE(6), allowNull: false, defaultValue: DataTypes.NOW },
    },
    options('participants'),
  );
  C.init(
    {
      id,
      position: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      title: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
      public_files: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    },
    options('challenges'),
  );
  const refs = {
    participant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'participants', key: 'id' },
    },
    challenge_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'challenges', key: 'id' },
    },
  };
  R.init(
    {
      id,
      ...refs,
      completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      completed_at: { type: DataTypes.DATE(6), allowNull: true },
    },
    options('progress'),
  );
  S.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
      current_challenge: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      individual_progress_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      paused: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    options('competition_state'),
  );
  U.init(
    {
      id,
      ...refs,
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
      feedback: { type: DataTypes.TEXT, allowNull: true },
      files: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE(6), allowNull: false, defaultValue: DataTypes.NOW },
    },
    options('submissions'),
  );
  P.hasMany(R, {
    as: 'progress',
    foreignKey: 'participant_id',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  });
  P.hasMany(U, {
    as: 'submissions',
    foreignKey: 'participant_id',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  });
  C.hasMany(R, {
    as: 'progress',
    foreignKey: 'challenge_id',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  });
  C.hasMany(U, {
    as: 'submissions',
    foreignKey: 'challenge_id',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  });
  R.belongsTo(P, {
    as: 'participant',
    foreignKey: 'participant_id',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  });
  R.belongsTo(C, {
    as: 'challenge',
    foreignKey: 'challenge_id',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  });
  U.belongsTo(P, {
    as: 'participant',
    foreignKey: 'participant_id',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  });
  U.belongsTo(C, {
    as: 'challenge',
    foreignKey: 'challenge_id',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  });
  return { Participant: P, Challenge: C, Progress: R, CompetitionState: S, Submission: U };
}
