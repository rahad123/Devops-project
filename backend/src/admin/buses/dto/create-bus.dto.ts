import { IsString, IsUUID, IsInt, Min, Max, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BusType } from '@prisma/client';

export class CreateBusDto {
  @ApiProperty({ description: 'Operator that owns this bus' })
  @IsUUID()
  operatorId: string;

  @ApiProperty({ example: 'Shyamoli Volvo 3' })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({ enum: BusType })
  @IsEnum(BusType)
  busType: BusType;

  @ApiProperty({ example: 10, description: 'Number of seat rows; 4 seats are generated per row' })
  @IsInt()
  @Min(1)
  @Max(20)
  rows: number;
}
