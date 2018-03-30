
/** Incomplete list of Pivotal Tracker story properties - see https://www.pivotaltracker.com/help/api/rest/v5#story_resource */
interface IPivotalStory {
    id: number;
    project_id: number;
    name: string;
    description: string;
    story_type: "feature" | "bug" | "chore" | "release";
    current_state: "accepted" | "delivered" | "finished" | "started" | "rejected" | "planned" | "unstarted" | "unscheduled";
    estimate: number;
    accepted_at: Date;
    deadline: Date;
    projected_completion: Date;
    points_accepted: number;
    points_total: number;
    requested_by_id: number;
    tasks: IPivotalTaskProperty;
    notes: IPivotalNoteProperty;
  }
  
  interface IPivotalTaskProperty {
    task: IPivotalTask | IPivotalTask[];
  }
  
  interface IPivotalTask {
    id: number;
    story_id: number;
    description: string;
    complete: boolean;
    position: number;
    created_at: Date;
    updated_at: Date;
    kind: string;
  }
  
  interface IPivotalNoteProperty {
    note: IPivotalNote | IPivotalNote[];
  }
  
  interface IPivotalNote {
    id: number;
    story_id: number;
    epic_id: number;
    text: string;
    person_id: number;
    created_at: Date;
    updated_at: Date;
    file_attachment_ids: number[];
    google_attachment_ids: number[];
    commit_identifier: string;
    commit_type: string;
    kind: string;
  }
  