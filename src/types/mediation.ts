class SQLTable {
  name: string
  alias: string
  columns?: Object
}

class MediationEntity {
  entity1: MediationEntity | SQLTable
  entity2?: MediationEntity | SQLTable
  type?: string
  columns?: Object
  params?: Array<string>
}