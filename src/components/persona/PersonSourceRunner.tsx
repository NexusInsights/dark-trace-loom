import { allTools } from "@/components/tools/toolDefinitions";
import { ToolRunner } from "@/components/tools/ToolRunner";
export default function PersonSourceRunner({sourceId,personId,initialInputs,onBack,onSaved}:{sourceId:string;personId:string;initialInputs:Record<string,string>;onBack:()=>void;onSaved:()=>void}) {
  const tool=allTools.find(t=>t.id===sourceId);
  if(!tool)return <p role="alert">This source is unavailable in the current build. <button onClick={onBack}>Return to the dossier</button></p>;
  const allowedInputs=Object.fromEntries(Object.entries(initialInputs).filter(([key])=>tool.fields.some(field=>field.key===key)));
  return <ToolRunner tool={tool} personId={personId} initialInputs={allowedInputs} onBack={onBack} onSaved={onSaved}/>;
}
