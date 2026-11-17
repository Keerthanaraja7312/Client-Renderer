// import { CONFIG } from "@/utils/env"
// import { useState, useEffect } from "react"

// interface UseComponentDataProps<S> {
//   dataSourceId: string | number | null | undefined
//   type?: string | null
//   processId?: string | number | null
//   componentDataSchema?: S
//   query?: any
// }

// export const useComponentData = <S = any>({
//   dataSourceId,
//   type,
//   processId,
//   componentDataSchema,
//   query,
// }: UseComponentDataProps<S>) => {
//   const [data, setData] = useState<S[] | null>(null)
//   const [loading, setLoading] = useState(false)
//   const [error, setError] = useState<string | null>(null)

//   // useEffect(() => {
//   //   const fetchData = async () => {
//   //     if (!dataSourceId && !processId) {
//   //       setData(null)
//   //       setLoading(false)
//   //       return
//   //     }

//   //     setLoading(true)
//   //     setError(null)

//   //     try {
//   //       const response = await fetch(
//   //         `${CONFIG.VITE_API_BASE}/lookup/get-component-data`,
//   //         {
//   //           method: "POST",
//   //           headers: { "Content-Type": "application/json" },
//   //           body: JSON.stringify({
//   //             processId: Number(processId || dataSourceId),
//   //             type: type || "",
//   //             component_data_schema: componentDataSchema,
//   //             filters: query?.filters || {
//   //               criteria: {
//   //                 conditions_group: [],
//   //                 conditions_group_link: {
//   //                   type: "group",
//   //                   operator: "AND",
//   //                   children: [],
//   //                 },
//   //               },
//   //             },
//   //           }),
//   //         }
//   //       )

//   //       const result = await response.json()

//   //       if (result.status === "success") {
//   //         setData(result.data)
//   //       } else {
//   //         setError(result.message || "Failed to fetch data")
//   //       }
//   //     } catch (err) {
//   //       console.error("Fetch error:", err)
//   //       setError("Network error")
//   //     } finally {
//   //       setLoading(false)
//   //     }
//   //   }

//   //   fetchData()
//   // }, [dataSourceId, JSON.stringify(componentDataSchema), JSON.stringify(query)])

//   useEffect(() => {
//   let cancelled = false;

//   async function loadSources() {
//     try {
//       const tables = await fetchAvailableDataSources();

//       const queries = await fetchQueryDefinitions();

//       if (!cancelled) {
//         setDataSources([
//           ...tables.map((s:any) => ({
//             ...s,
//             type: "table"
//           })),

//           ...queries.map((q:any) => ({
//             ...q,
//             id: String(q.id),
//             name: q.name,
//             type: "query",
//             availableFields: q.availableFields || []
//           }))
//         ]);
//       }

//     } catch(err) {
//       console.error("Failed loading sources:", err);
//     }
//   }

//   loadSources();

//   return () => {
//     cancelled = true;
//   };

// }, []);

//   return { data, loading, error }
// }


import { CONFIG } from "@/utils/env"
import { useState, useEffect } from "react"

interface UseComponentDataProps<S> {
  dataSourceId: string | number | null | undefined
  type?: string | null
  processId?: string | number | null
  componentDataSchema?: S
  query?: any
}


export const useComponentData = <S = any>({
  dataSourceId,
  type,
  processId,
  componentDataSchema,
  query,
}: UseComponentDataProps<S>) => {

  const [data, setData] = useState<S[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)


  // useEffect(() => {
  //   const fetchData = async () => {
  //     console.log(
  //       "useComponentData:",
  //       {
  //         dataSourceId,
  //         type
  //       }
  //     )

  //     if (!dataSourceId && !processId) {
  //       setData(null)
  //       return
  //     }
  //     setLoading(true)
  //     setError(null)

  //     try {
  //       let response: Response

  //       // Saved Query execution
  //       if (type === "query") {
  //         response = await fetch(
  //           `${CONFIG.VITE_API_BASE}/query-builder/definitions/${dataSourceId}/execute`,
  //           {
  //             method: "POST",
  //             headers:{
  //               "Content-Type":"application/json"
  //             }
  //           }
  //         )
  //       } 
        
  //       // Normal table/component data
  //       else {
  //         response = await fetch(
  //           `${CONFIG.VITE_API_BASE}/lookup/get-component-data`,
  //           {
  //             method:"POST",
  //             headers:{
  //               "Content-Type":"application/json"
  //             },
  //             body:JSON.stringify({
  //               processId:Number(processId || dataSourceId),
  //               type:type || "",
  //               component_data_schema:componentDataSchema,
  //               filters: query?.filters || {
  //                 criteria:{
  //                   conditions_group:[],
  //                   conditions_group_link:{
  //                     type:"group",
  //                     operator:"AND",
  //                     children:[]
  //                   }
  //                 }
  //               }
  //             })
  //           }
  //         )
  //       }
  //       const result = await response.json()
  //       console.log(
  //         "Component data response:",
  //         result
  //       )

  //       if(result.status==="success") {
  //         setData(result.data)
  //       } else {
  //         setError(
  //           result.message || "Failed to fetch data"
  //         )
  //       }


  //     } catch(err:any){
  //       console.error(
  //         "Fetch error:",
  //         err
  //       )
  //       setError(
  //         "Network error"
  //       )
  //     }
  //     finally{
  //       setLoading(false)
  //     }
  //   }
  //   fetchData()

  // },[
  //   dataSourceId,
  //   type,
  //   processId,
  //   JSON.stringify(componentDataSchema),
  //   JSON.stringify(query)
  // ])

  useEffect(() => {

  async function loadData() {

    if (!dataSourceId) {
      setData(null);
      return;
    }


    setLoading(true);
    setError(null);


    try {


      // ==========================
      // TABLE DATA SOURCE
      // ==========================
      if (type === "table") {


        const response = await fetch(
          `${CONFIG.VITE_API_BASE}/datastore/${dataSourceId}/rows`
        );


        const result = await response.json();


        setData(result.data || result);

      }



      // ==========================
      // QUERY DATA SOURCE
      // ==========================
      else if (type === "query") {


        const definition = await fetchQueryDefinition(
          Number(dataSourceId)
        );


        const result = await executeQuery(
          definition.query_json
        );


        setData(result.data || []);

      }


    } catch(err:any) {

      console.error(
        "Failed loading component data",
        err
      );

      setError(err.message);

    }
    finally {

      setLoading(false);

    }

  }


  loadData();


}, [
  dataSourceId,
  type,
  JSON.stringify(query)
]);


  return {
    data,
    loading,
    error
  }

}